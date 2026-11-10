
/* =================================
   VEXCHAT - GITHUB PAGES VERSION
   ================================= */

// ADD YOUR SUPABASE DETAILS HERE
const SUPABASE_URL = "https://sprhwvrzpltridhikttp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JTH82eb7Tk7s4MEXCQPPGA_6Cn70nKy";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let currentChat = null;
let messageSubscription = null;
let friends = [];

function notify(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.display = "none";
  }, 3000);
}

function showError(message) {
  $("authError").textContent = message;
}

function showApp() {
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
}

function showAuth() {
  $("app").classList.add("hidden");
  $("authScreen").classList.remove("hidden");
}

async function signup() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const username = $("authUsername").value.trim();

  if (!email || !password || !username) {
    showError("Fill in all three fields.");
    return;
  }

  if (password.length < 6) {
    showError("Password must be at least 6 characters.");
    return;
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (error) {
    showError(error.message);
    return;
  }

  if (data.session) {
    await loadApp();
  } else {
    showError("Account created! Check your email to confirm your account.");
  }
}

async function login() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  const { error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showError(error.message);
    return;
  }

  await loadApp();
}

async function logout() {
  await db.auth.signOut();

  if (messageSubscription) {
    await db.removeChannel(messageSubscription);
  }

  currentUser = null;
  currentProfile = null;
  currentChat = null;

  showAuth();
}

async function loadApp() {
  const { data } = await db.auth.getUser();

  if (!data.user) {
    showAuth();
    return;
  }

  currentUser = data.user;

  const username =
    currentUser.user_metadata.username ||
    currentUser.email.split("@")[0];

  const { error } = await db
    .from("profiles")
    .upsert({
      id: currentUser.id,
      username: username,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });

  if (error) {
    showError(error.message);
    return;
  }

  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  currentProfile = profile;

  $("myUsername").textContent = profile.username;
  $("myAvatar").textContent = profile.username[0].toUpperCase();

  showApp();

  await loadFriends();
  await loadRequests();
}

async function loadFriends() {
  const { data, error } = await db
    .from("friendships")
    .select("*")
    .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`)
    .eq("status", "accepted");

  if (error) {
    notify(error.message);
    return;
  }

  friends = [];

  for (const relation of data || []) {
    const otherId =
      relation.user_id === currentUser.id
        ? relation.friend_id
        : relation.user_id;

    const { data: profile } = await db
      .from("profiles")
      .select("*")
      .eq("id", otherId)
      .maybeSingle();

    if (profile) friends.push(profile);
  }

  const list = $("friendsList");
  list.innerHTML = "";

  if (!friends.length) {
    list.innerHTML = '<p class="muted">No friends yet.</p>';
    return;
  }

  friends.forEach(friend => {
    const item = document.createElement("div");
    item.className = "friend";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = friend.username[0].toUpperCase();

    const name = document.createElement("span");
    name.textContent = friend.username;

    item.append(avatar, name);

    item.onclick = () => openChat(friend);

    list.appendChild(item);
  });
}

async function addFriend() {
  const username = prompt("Enter your friend's username:");

  if (!username) return;

  const { data: profile, error } = await db
    .from("profiles")
    .select("id,username")
    .ilike("username", username.trim())
    .maybeSingle();

  if (error || !profile) {
    notify("User not found.");
    return;
  }

  if (profile.id === currentUser.id) {
    notify("You cannot add yourself.");
    return;
  }

  const { data: existing } = await db
    .from("friendships")
    .select("id")
    .or(
      `and(user_id.eq.${currentUser.id},friend_id.eq.${profile.id}),and(user_id.eq.${profile.id},friend_id.eq.${currentUser.id})`
    )
    .maybeSingle();

  if (existing) {
    notify("A friendship or request already exists.");
    return;
  }

  const { error: insertError } = await db
    .from("friendships")
    .insert({
      user_id: currentUser.id,
      friend_id: profile.id,
      status: "pending"
    });

  if (insertError) {
    notify(insertError.message);
  } else {
    notify("Friend request sent!");
  }
}

async function loadRequests() {
  const { data, error } = await db
    .from("friendships")
    .select("*")
    .eq("friend_id", currentUser.id)
    .eq("status", "pending");

  const list = $("requestsList");
  list.innerHTML = "";

  if (error || !data) return;

  for (const request of data) {
    const { data: profile } = await db
      .from("profiles")
      .select("*")
      .eq("id", request.user_id)
      .maybeSingle();

    if (!profile) continue;

    const row = document.createElement("div");
    row.className = "friend";

    const name = document.createElement("span");
    name.textContent = profile.username;

    const accept = document.createElement("button");
    accept.textContent = "✓";
    accept.onclick = () => acceptRequest(request.id);

    row.append(name, accept);
    list.appendChild(row);
  }
}

async function acceptRequest(id) {
  const { error } = await db
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", id)
    .eq("friend_id", currentUser.id);

  if (error) {
    notify(error.message);
    return;
  }

  notify("Friend added!");
  await loadFriends();
  await loadRequests();
}

async function openChat(friend) {
  currentChat = friend;

  $("welcome").classList.add("hidden");
  $("messages").classList.remove("hidden");
  $("messageForm").classList.remove("hidden");

  $("chatTitle").textContent = friend.username;
  $("chatSubtitle").textContent = "Direct messages";

  if (messageSubscription) {
    await db.removeChannel(messageSubscription);
    messageSubscription = null;
  }

  await loadMessages();

  messageSubscription = db
    .channel("chat-" + currentUser.id + "-" + friend.id)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      payload => {
        const message = payload.new;

        if (
          message.sender_id === currentUser.id &&
          message.receiver_id === friend.id ||
          message.sender_id === friend.id &&
          message.receiver_id === currentUser.id
        ) {
          addMessage(message);
        }
      }
    )
    .subscribe();
}

async function loadMessages() {
  const { data, error } = await db
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${currentChat.id}),and(sender_id.eq.${currentChat.id},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: true });

  if (error) {
    notify(error.message);
    return;
  }

  $("messages").innerHTML = "";

  (data || []).forEach(addMessage);
}

function addMessage(message) {
  const container = $("messages");

  if (
    container.querySelector(
      `[data-message-id="${CSS.escape(String(message.id))}"]`
    )
  ) return;

  const wrapper = document.createElement("div");
  wrapper.className =
    "message" +
    (message.sender_id === currentUser.id ? " mine" : "");

  wrapper.dataset.messageId = message.id;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent =
    message.sender_id === currentUser.id
      ? currentProfile.username[0].toUpperCase()
      : currentChat.username[0].toUpperCase();

  const content = document.createElement("div");
  content.className = "message-content";

  const sender = document.createElement("small");
  sender.textContent =
    message.sender_id === currentUser.id
      ? "You"
      : currentChat.username;

  const text = document.createElement("p");
  text.textContent = message.content;

  content.append(sender, text);
  wrapper.append(avatar, content);

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

async function sendMessage(event) {
  event.preventDefault();

  if (!currentChat) return;

  const content = $("messageInput").value.trim();

  if (!content) return;

  $("messageInput").value = "";

  const { error } = await db
    .from("messages")
    .insert({
      sender_id: currentUser.id,
      receiver_id: currentChat.id,
      content
    });

  if (error) {
    notify(error.message);
    $("messageInput").value = content;
  }
}

// Search registered users
$("userSearch").addEventListener("input", async event => {
  const query = event.target.value.trim();

  if (!query || !currentUser) return;

  const { data } = await db
    .from("profiles")
    .select("username")
    .ilike("username", `%${query}%`)
    .neq("id", currentUser.id)
    .limit(5);

  if (data?.length) {
    notify("Users found: " + data.map(u => u.username).join(", "));
  }
});

// Event listeners
$("loginBtn").onclick = login;
$("signupBtn").onclick = signup;
$("logoutBtn").onclick = logout;
$("addFriendBtn").onclick = addFriend;
$("messageForm").onsubmit = sendMessage;

// Restore login session
db.auth.onAuthStateChange((event, session) => {
  if (session?.user && !currentUser) {
    setTimeout(loadApp, 0);
  }

  if (event === "SIGNED_OUT") {
    currentUser = null;
    showAuth();
  }
});

(async function start() {
  const { data } = await db.auth.getSession();

  if (data.session) {
    await loadApp();
  } else {
    showAuth();
  }
})();

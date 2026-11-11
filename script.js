
/* ==========================================
   VEXCHAT - COMPLETE FRONTEND
   Supabase + GitHub Pages
========================================== */

// YOUR EXISTING SUPABASE DETAILS
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
let searchTimer = null;

// ==========================================
// NOTIFICATIONS
// ==========================================

function notify(message) {
  const toast = $("toast");

  toast.textContent = message;
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

function showError(message) {
  $("authError").textContent = message;
}

// ==========================================
// NAVIGATION
// ==========================================

function showApp() {
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
}

function showAuth() {
  $("app").classList.add("hidden");
  $("authScreen").classList.remove("hidden");
}

function switchView(view) {
  $("welcome").classList.add("hidden");
  $("messages").classList.add("hidden");
  $("messageForm").classList.add("hidden");
  $("settingsView").classList.add("hidden");

  document.querySelectorAll(".server-icon").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === view
    );
  });

  if (view === "home") {
    $("welcome").classList.remove("hidden");

    $("chatTitle").textContent = "Welcome to VEXCHAT";
    $("chatSubtitle").textContent = "Choose a friend to start chatting.";
    currentChat = null;
  }

  if (view === "messages") {
    $("chatTitle").textContent = "Messages";
    $("chatSubtitle").textContent = "Choose a friend to start chatting.";

    if (currentChat) {
      $("messages").classList.remove("hidden");
      $("messageForm").classList.remove("hidden");
    } else {
      $("welcome").classList.remove("hidden");
    }
  }

  if (view === "settings") {
    $("settingsView").classList.remove("hidden");

    $("settingsUsername").textContent =
      currentProfile?.username || "User";

    $("settingsEmail").textContent =
      currentUser?.email || "Not available";

    $("chatTitle").textContent = "Settings";
    $("chatSubtitle").textContent = "Manage your account.";
  }
}

// ==========================================
// SIGN UP
// ==========================================

async function signup() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const username = $("authUsername").value.trim();

  showError("");

  if (!email || !password || !username) {
    showError("Fill in all three fields.");
    return;
  }

  if (password.length < 6) {
    showError("Password must be at least 6 characters.");
    return;
  }

  try {
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
      showError(
        "Account created! Sign-in may require confirmation depending on your Supabase settings."
      );
    }

  } catch (error) {
    showError(error.message);
  }
}

// ==========================================
// LOG IN
// ==========================================

async function login() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  showError("");

  if (!email || !password) {
    showError("Enter your email and password.");
    return;
  }

  try {
    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showError(error.message);
      return;
    }

    await loadApp();

  } catch (error) {
    showError(error.message);
  }
}

// ==========================================
// LOG OUT
// ==========================================

async function logout() {
  if (messageSubscription) {
    await db.removeChannel(messageSubscription);
    messageSubscription = null;
  }

  const { error } = await db.auth.signOut();

  if (error) {
    notify(error.message);
    return;
  }

  currentUser = null;
  currentProfile = null;
  currentChat = null;
  friends = [];

  $("friendsList").innerHTML = "";
  $("requestsList").innerHTML = "";

  showAuth();
}

// ==========================================
// LOAD APPLICATION
// ==========================================

async function loadApp() {
  try {
    const { data, error: authError } = await db.auth.getUser();

    if (authError || !data.user) {
      showAuth();
      return;
    }

    currentUser = data.user;

    const username =
      currentUser.user_metadata.username ||
      currentUser.email.split("@")[0];

    const { error: upsertError } = await db
      .from("profiles")
      .upsert({
        id: currentUser.id,
        username: username,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "id"
      });

    if (upsertError) {
      notify("Profile error: " + upsertError.message);
      return;
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .single();

    if (profileError || !profile) {
      notify("Could not load your profile.");
      return;
    }

    currentProfile = profile;

    $("myUsername").textContent = profile.username;
    $("myAvatar").textContent =
      profile.username[0].toUpperCase();

    $("settingsUsername").textContent = profile.username;
    $("settingsEmail").textContent = currentUser.email;

    showApp();
    switchView("home");

    await loadFriends();
    await loadRequests();

  } catch (error) {
    notify("Loading error: " + error.message);
  }
}

// ==========================================
// LOAD FRIENDS
// ==========================================

async function loadFriends() {
  const { data, error } = await db
    .from("friendships")
    .select("*")
    .or(
      `user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`
    )
    .eq("status", "accepted");

  if (error) {
    notify("Friends error: " + error.message);
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

    if (profile) {
      friends.push(profile);
    }
  }

  renderFriends();
}

function renderFriends() {
  const list = $("friendsList");
  list.innerHTML = "";

  if (!friends.length) {
    list.innerHTML =
      '<p class="muted">No friends yet. Add someone to start chatting!</p>';
    return;
  }

  friends.forEach(friend => {
    const item = document.createElement("div");

    item.className = "friend";

    if (currentChat?.id === friend.id) {
      item.classList.add("selected");
    }

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

// ==========================================
// ADD FRIEND
// ==========================================

async function addFriend(usernameFromSearch = null) {
  const username = usernameFromSearch ||
    prompt("Enter your friend's username:");

  if (!username || !username.trim()) return;

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

  const { data: existing, error: existingError } = await db
    .from("friendships")
    .select("id")
    .or(
      `and(user_id.eq.${currentUser.id},friend_id.eq.${profile.id}),and(user_id.eq.${profile.id},friend_id.eq.${currentUser.id})`
    )
    .maybeSingle();

  if (existingError) {
    notify(existingError.message);
    return;
  }

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
    $("userSearchResults").innerHTML = "";
    $("userSearch").value = "";
  }
}

// ==========================================
// SEARCH USERS
// ==========================================

async function searchUsers(query) {
  const results = $("userSearchResults");

  if (!query || !currentUser) {
    results.innerHTML = "";
    return;
  }

  const { data, error } = await db
    .from("profiles")
    .select("id,username")
    .ilike("username", `%${query}%`)
    .neq("id", currentUser.id)
    .limit(6);

  results.innerHTML = "";

  if (error) {
    return;
  }

  if (!data || !data.length) {
    results.innerHTML =
      '<div class="search-result">No users found.</div>';
    return;
  }

  data.forEach(user => {
    const result = document.createElement("div");
    result.className = "search-result";
    result.textContent = user.username;

    result.onclick = () => addFriend(user.username);

    results.appendChild(result);
  });
}

// ==========================================
// LOAD FRIEND REQUESTS
// ==========================================

async function loadRequests() {
  const { data, error } = await db
    .from("friendships")
    .select("*")
    .eq("friend_id", currentUser.id)
    .eq("status", "pending");

  const list = $("requestsList");
  list.innerHTML = "";

  if (error) {
    notify("Request error: " + error.message);
    return;
  }

  for (const request of data || []) {
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
    accept.title = "Accept friend request";

    accept.onclick = () => acceptRequest(request.id);

    row.append(name, accept);
    list.appendChild(row);
  }
}

// ==========================================
// ACCEPT FRIEND REQUEST
// ==========================================

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

// ==========================================
// OPEN CHAT
// ==========================================

async function openChat(friend) {
  currentChat = friend;

  $("welcome").classList.add("hidden");
  $("settingsView").classList.add("hidden");
  $("messages").classList.remove("hidden");
  $("messageForm").classList.remove("hidden");

  $("chatTitle").textContent = friend.username;
  $("chatSubtitle").textContent = "Direct messages";

  document.querySelectorAll(".server-icon").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === "messages"
    );
  });

  renderFriends();

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

        const belongsToChat =
          (message.sender_id === currentUser.id &&
           message.receiver_id === friend.id) ||
          (message.sender_id === friend.id &&
           message.receiver_id === currentUser.id);

        if (belongsToChat) {
          addMessage(message);
        }
      }
    )
    .subscribe();
}

// ==========================================
// LOAD MESSAGES
// ==========================================

async function loadMessages() {
  if (!currentChat) return;

  const { data, error } = await db
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${currentChat.id}),and(sender_id.eq.${currentChat.id},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: true });

  if (error) {
    notify("Message error: " + error.message);
    return;
  }

  $("messages").innerHTML = "";

  (data || []).forEach(addMessage);
}

// ==========================================
// DISPLAY MESSAGE
// ==========================================

function addMessage(message) {
  const container = $("messages");

  const existing = Array.from(
    container.querySelectorAll(".message")
  ).some(element =>
    element.dataset.messageId === String(message.id)
  );

  if (existing) return;

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

// ==========================================
// SEND MESSAGE
// ==========================================

async function sendMessage(event) {
  event.preventDefault();

  if (!currentChat) {
    notify("Choose a friend first.");
    return;
  }

  const input = $("messageInput");
  const content = input.value.trim();

  if (!content) return;

  input.value = "";

  const { error } = await db
    .from("messages")
    .insert({
      sender_id: currentUser.id,
      receiver_id: currentChat.id,
      content
    });

  if (error) {
    notify("Could not send message: " + error.message);
    input.value = content;
  }
}

// ==========================================
// BUTTON CONNECTIONS
// ==========================================

$("loginBtn").onclick = login;
$("signupBtn").onclick = signup;

$("logoutBtn").onclick = logout;
$("settingsLogoutBtn").onclick = logout;

$("addFriendBtn").onclick = () => addFriend();
$("homeAddFriendBtn").onclick = () => addFriend();

$("messageForm").onsubmit = sendMessage;

// Navigation buttons
document.querySelectorAll(".server-icon").forEach(button => {
  button.addEventListener("click", () => {
    switchView(button.dataset.view);
  });
});

// User search
$("userSearch").addEventListener("input", event => {
  clearTimeout(searchTimer);

  const query = event.target.value.trim();

  searchTimer = setTimeout(() => {
    searchUsers(query);
  }, 300);
});

// Close search results when clicking elsewhere
document.addEventListener("click", event => {
  if (
    !event.target.closest(".search-wrap")
  ) {
    $("userSearchResults").innerHTML = "";
  }
});

// ==========================================
// RESTORE LOGIN SESSION
// ==========================================

db.auth.onAuthStateChange((event, session) => {
  if (session?.user && !currentUser) {
    setTimeout(() => loadApp(), 0);
  }

  if (event === "SIGNED_OUT") {
    currentUser = null;
    currentProfile = null;
    currentChat = null;
    showAuth();
  }
});

// ==========================================
// START VEXCHAT
// ==========================================

(async function start() {
  try {
    const { data, error } = await db.auth.getSession();

    if (error) {
      notify(error.message);
      return;
    }

    if (data.session) {
      await loadApp();
    } else {
      showAuth();
    }

  } catch (error) {
    notify("Startup error: " + error.message);
  }
})();

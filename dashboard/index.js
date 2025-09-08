// ===== Imports =====
import {
  getFirestore, doc, getDoc, collection, query, orderBy, limit, getDocs,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

import {
  getAuth, onAuthStateChanged, signOut, getIdTokenResult
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

import { app } from "../firebase-config.js";

// ===== Setup =====
const auth = getAuth(app);
const db = getFirestore(app);

// IMPORTANT: keep schema consistent across app
//   role: "admin" | "user"   (stored lowercase in Firestore)
//   companyIds: string[]     (company names/IDs the user can access; empty for admin)
let IS_ADMIN = false;

// Show whatever companies you support in the UI
const COMPANY_OPTIONS = ["Siox Global", "Rank Me Now", "Choksi Hotels"];
const ROLE_OPTIONS = ["Admin", "User"]; // UI labels (we store lowercase)

// Normalize company labels to a single canonical key
function normalizeCompanyLabel(label = "") {
  const s = String(label).toLowerCase().trim();

  // fix frequent variations/typos
  if (s.includes("siox")) return "siox global";
  if (s.includes("rank")) return "rank me now";
  if (s.includes("choksi") || s.includes("chokshi")) return "choksi hotels";

  // fallbacks for generic "company 3/4/5"
  if (s.includes("company 3")) return "company 3";
  if (s.includes("company 4")) return "company 4";
  if (s.includes("company 5")) return "company 5";

  return s; // last resort: raw lowercased
}

function enforceCompanyVisibility(isAdmin, companyIds = []) {
  const allowed = new Set(companyIds.map(c => normalizeCompanyLabel(c)));

  document.querySelectorAll(".companies-list .company-card-link").forEach(card => {
    // Prefer explicit data-company; otherwise use visible tile text
    const tag = card.dataset.company || "";
    const labelEl = card.querySelector(".company-value");
    const visibleText = labelEl ? labelEl.textContent : "";
    const key = normalizeCompanyLabel(tag || visibleText);

    const canSee = isAdmin || allowed.has(key);
    card.style.display = canSee ? "block" : "none";
  });
}

// ===== Empty-state helpers for Companies (User with no access) =====
function removeEmptyCompaniesCard() {
  const list = document.getElementById("companiesList");
  const existing = list?.querySelector('.company-card-link.empty-state');
  if (existing) existing.remove();
}

function insertEmptyCompaniesCard() {
  const list = document.getElementById("companiesList");
  if (!list) return;

  if (list.querySelector('.company-card-link.empty-state')) return; // don't duplicate

  const a = document.createElement('a');
  a.href = "#";
  a.className = "company-card-link empty-state";
  a.setAttribute('aria-disabled', 'true');
  a.style.pointerEvents = "none"; // non-clickable

  a.innerHTML = `
    <div class="company-card company-card--empty">
      <div class="company-value">No company access yet</div>
      <div class="company-sub">Ask an admin to grant you access.</div>
      <div class="company-hint"><i class="fas fa-lock"></i> Restricted</div>
    </div>
  `;
  list.appendChild(a);
}

/**
 * Show the empty-state ONLY when:
 *  - role === "user" (not admin)
 *  - AND (companyIds.length === 0)
 *  - AND no company tiles are visible after gating
 */
function updateCompaniesEmptyState(role, companyIds = []) {
  const list = document.getElementById("companiesList");
  if (!list) return;

  // Count visible (non-empty-state) tiles after enforceCompanyVisibility
  const visibleRealCards = Array.from(list.querySelectorAll('.company-card-link'))
    .filter(el => !el.classList.contains('empty-state') && el.style.display !== 'none');

  const isUser = String(role || "user").toLowerCase() === "user";
  const hasNoAccess = !Array.isArray(companyIds) || companyIds.length === 0;

  if (isUser && hasNoAccess && visibleRealCards.length === 0) {
    insertEmptyCompaniesCard();
  } else {
    removeEmptyCompaniesCard();
  }
}


// ===== Utilities =====
function toUiRole(role) {
  return (String(role || "user").toLowerCase() === "admin") ? "Admin" : "User";
}
function toDbRole(uiRole) {
  return (String(uiRole).toLowerCase() === "admin") ? "admin" : "user";
}

function ensureArray(val, fallback = []) {
  if (Array.isArray(val)) return val;
  if (val == null) return fallback;
  // migrate legacy `company` (string or array) to array
  if (typeof val === "string") return val ? [val] : fallback;
  return fallback;
}

// ===== DOM Ready =====
document.addEventListener("DOMContentLoaded", () => {
  const userNameElement = document.querySelector(".user-name");
  const userRoleElement = document.querySelector(".user-role");
  const dropdownName = document.querySelector(".dropdown-name");
  const dropdownEmail = document.querySelector(".dropdown-email");
  const userprofileimgElement = document.querySelector(".avatar");
  const userAvatar = document.querySelector(".profile-img");
  const logoutBtn = document.getElementById("logoutBtn");

  const usersNavItem = document.querySelector('.nav-item[data-section="users"]');

  // Sidebar navigation
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => showSection(item.getAttribute("data-section")));
  });

  // ===== Auth state =====
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login/login.html";
      return;
    }
  
    await getIdTokenResult(user, true);
  
    const isCompany = user.email?.toLowerCase().endsWith("@sioxglobal.com");
    if (!user.emailVerified || !isCompany) {
      window.location.href = "../verify-email/verify-email.html";
      return;
    }
  
    // Determine admin via Firestore user doc
    try {
      const meSnap = await getDoc(doc(db, "users", user.uid));
      const me = meSnap.exists() ? meSnap.data() : null;
      const role = String(me?.role || "user").toLowerCase();
      IS_ADMIN = role === "admin";
      if (usersNavItem) usersNavItem.style.display = IS_ADMIN ? "flex" : "none";
  
      // NEW: read company access (accept legacy `company` too)
      const myCompanies = Array.isArray(me?.companyIds)
        ? me.companyIds
        : (Array.isArray(me?.company) ? me.company : (me?.company ? [me.company] : []));
  
      // NEW: gate the tiles (admin = all, user = only assigned)
      enforceCompanyVisibility(IS_ADMIN, myCompanies);
      updateCompaniesEmptyState(role, myCompanies);
  
    } catch (e) {
      console.error("Failed to read current user role:", e);
      IS_ADMIN = false;
      if (usersNavItem) usersNavItem.style.display = "none";
  
      // NEW: safest fallback—hide all tiles for non-admins when profile read fails
      enforceCompanyVisibility(false, []);
      updateCompaniesEmptyState("user", []); // 👈 add here too
    }
  
    // Identity UI (unchanged)
    let displayName = user.displayName || (user.email ? user.email.split("@")[0] : "User");
    userNameElement && (userNameElement.textContent = displayName);
    dropdownName && (dropdownName.textContent = displayName);
    dropdownEmail && (dropdownEmail.textContent = user.email || "");
    const parts = displayName.trim().split(/\s+/);
    let initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0] || "U";
    initials = initials.toUpperCase();
    userprofileimgElement && (userprofileimgElement.textContent = initials);
    userAvatar && (userAvatar.textContent = initials);
    userRoleElement && (userRoleElement.textContent = IS_ADMIN ? "Admin" : "Authenticated User");
  
    showSection("dashboard");
  });
  

  // Logout
  logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "../login/login.html";
    } catch (err) {
      console.error("Logout failed", err);
    }
  });
});

// ===== Section switching =====
function showSection(section) {
  const dashboard = document.getElementById("dashboard-section");
  const users = document.getElementById("users-section");

  if (dashboard) dashboard.style.display = "none";
  if (users) users.style.display = "none";

  if (section === "dashboard" && dashboard) {
    dashboard.style.display = "block";
  } else if (section === "users" && users) {
    if (!IS_ADMIN) {
      alert("You don’t have permission to view Users.");
      dashboard && (dashboard.style.display = "block");
      section = "dashboard";
    } else {
      users.style.display = "block";
      loadUsers();
    }
  }

  document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
  const clicked = document.querySelector(`.nav-item[data-section="${section}"]`);
  clicked && clicked.classList.add("active");
}
window.showSection = showSection;

// ===== Load Users (Admin only) =====
async function loadUsers() {
  const tbody = document.getElementById("usersTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5">Loading...</td></tr>`;

  try {
    // order by displayName (exists for Google SSO) or switch to email if you prefer
    const qUsers = query(collection(db, "users"), orderBy("email"));
    const snap = await getDocs(qUsers);

    let rows = "";
    snap.forEach(docSnap => {
      const u = docSnap.data();
      const uid = u.uid || docSnap.id;

      const first = u.firstName || "";
      const last = u.lastName ? ` ${u.lastName}` : "";
      const fallback = u.displayName || (u.email ? u.email.split("@")[0] : "");
      const fullName = (first || fallback) + last;

      const uiRole = toUiRole(u.role);
      // accept old `company` field for backward compatibility
      const companies = ensureArray(u.companyIds ?? u.company, []);

      rows += `
        <tr data-uid="${uid}">
          <td>${fullName || "-"}</td>
          <td>${u.email || "-"}</td>
          <td class="role-cell" data-original="${uiRole}">${uiRole}</td>
          <td class="company-cell" data-original="${companies.join(", ")}">
            ${uiRole === "Admin" ? "All Companies" : (companies.length ? companies.join(", ") : "-")}
          </td>
          <td>
            ${IS_ADMIN
              ? `<button class="edit-btn btn btn-sm" data-uid="${uid}">✏️ Edit</button>`
              : `<span class="status" title="Only Admins can edit">Locked</span>`}
          </td>
        </tr>`;
    });

    tbody.innerHTML = rows || `<tr><td colspan="5">No users found.</td></tr>`;
  } catch (e) {
    console.error("❌ Firestore error (loadUsers):", e);
    tbody.innerHTML = `<tr><td colspan="5">Failed to load users.</td></tr>`;
  }
}

function buildCompanySelect(uid, selectedCompanies = []) {
  return `
    <select id="company-${uid}" class="company-select" multiple>
      ${COMPANY_OPTIONS.map(opt => `
        <option value="${opt}" ${selectedCompanies.includes(opt) ? "selected" : ""}>
          ${opt}
        </option>`).join("")}
    </select>
    <br><small class="hint">Hold Ctrl/Cmd to select multiple</small>
  `;
}

// ===== Edit / Save / Cancel =====
document.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".edit-btn");
  const saveBtn = e.target.closest(".save-btn");
  const cancelBtn = e.target.closest(".cancel-btn");

  // --- Edit mode ---
  if (editBtn) {
    if (!IS_ADMIN) { alert("You don't have permission."); return; }

    const uid = editBtn.dataset.uid;
    const row = document.querySelector(`tr[data-uid="${uid}"]`);
    if (!row) return;

    const roleCell = row.querySelector(".role-cell");
    const companyCell = row.querySelector(".company-cell");
    const currentRole = (roleCell?.textContent || "").trim();
    const currentCompanies = (companyCell.getAttribute("data-original") || "")
      .split(",").map(c => c.trim()).filter(Boolean);

    // role dropdown
    roleCell.classList.add("editing");
    roleCell.innerHTML = `
      <select id="role-${uid}" class="role-select">
        ${ROLE_OPTIONS.map(opt => `<option value="${opt}" ${opt === currentRole ? "selected" : ""}>${opt}</option>`).join("")}
      </select>`;

    // company multi-select if role is User
    companyCell.classList.add("editing");
    companyCell.innerHTML = currentRole === "Admin"
      ? `<span>All Companies</span>`
      : buildCompanySelect(uid, currentCompanies);

    // replace edit with save/cancel
    editBtn.outerHTML = `
      <button class="save-btn btn btn-sm btn-primary" data-uid="${uid}">💾 Save</button>
      <button class="cancel-btn btn btn-sm" data-uid="${uid}">❌ Cancel</button>`;

    // live toggle on role change
    const roleSelect = row.querySelector(`#role-${uid}`);
    roleSelect.addEventListener("change", () => {
      if (roleSelect.value === "Admin") {
        companyCell.innerHTML = `<span>All Companies</span>`;
      } else {
        companyCell.innerHTML = buildCompanySelect(uid, currentCompanies);
      }
    });
    return;
  }

  // --- Save ---
  if (saveBtn) {
    if (!IS_ADMIN) { alert("You don't have permission."); return; }

    const uid = saveBtn.dataset.uid;
    const row = document.querySelector(`tr[data-uid="${uid}"]`);
    const roleEl = document.getElementById(`role-${uid}`);
    const companyEl = document.getElementById(`company-${uid}`);
    if (!row || !roleEl) return;

    const newUiRole = roleEl.value;        // "Admin" | "User"
    const newDbRole = toDbRole(newUiRole); // "admin" | "user"

    let newCompanies = [];
    if (companyEl) {
      newCompanies = Array.from(companyEl.selectedOptions).map(opt => opt.value);
    }

    if (newDbRole === "user" && newCompanies.length === 0) {
      alert("User must be assigned to at least one company.");
      return;
    }

    try {
      await updateDoc(doc(db, "users", uid), {
        role: newDbRole,
        companyIds: newDbRole === "admin" ? [] : newCompanies,
        features: {
          dashboard: true,
          reports: true,
          users: newDbRole === "admin",   // ✅ auto toggle users access
        },
        updatedAt: serverTimestamp(),
      });

      const roleCell = row.querySelector(".role-cell");
      const companyCell = row.querySelector(".company-cell");

      roleCell.classList.remove("editing");
      companyCell.classList.remove("editing");

      roleCell.textContent = newUiRole;
      roleCell.setAttribute("data-original", newUiRole);

      if (newDbRole === "admin") {
        companyCell.textContent = "All Companies";
        companyCell.setAttribute("data-original", "");
      } else {
        companyCell.textContent = newCompanies.join(", ");
        companyCell.setAttribute("data-original", newCompanies.join(", "));
      }

      const cancel = row.querySelector(".cancel-btn");
      saveBtn.outerHTML = `<button class="edit-btn btn btn-sm" data-uid="${uid}">✏️ Edit</button>`;
      cancel && cancel.remove();
    } catch (err) {
      console.error("Failed to update user:", err);
      alert("Failed to update user. Check Firestore rules.");
    }
    return;
  }

  // --- Cancel ---
  if (cancelBtn) {
    const uid = cancelBtn.dataset.uid;
    const row = document.querySelector(`tr[data-uid="${uid}"]`);
    if (!row) return;

    const roleCell = row.querySelector(".role-cell");
    const companyCell = row.querySelector(".company-cell");
    const originalRole = roleCell.getAttribute("data-original") || roleCell.textContent;
    const originalCompany = companyCell.getAttribute("data-original") || companyCell.textContent;

    roleCell.classList.remove("editing");
    companyCell.classList.remove("editing");

    roleCell.textContent = originalRole;
    companyCell.textContent = originalCompany;

    cancelBtn.previousElementSibling?.remove(); // remove save
    cancelBtn.outerHTML = `<button class="edit-btn btn btn-sm" data-uid="${uid}">✏️ Edit</button>`;
  }
});

// ===== Sidebar toggle =====
const appContainer = document.getElementById('appContainer');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
if (toggleSidebarBtn && appContainer) {
  toggleSidebarBtn.addEventListener('click', () => {
    appContainer.classList.toggle('sidebar-collapsed');
  });
}

// ===== Profile dropdown =====
const profileTrigger = document.getElementById('profileTrigger');
const profileDropdown = document.getElementById('profileDropdown');
if (profileTrigger && profileDropdown) {
  profileTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => profileDropdown.classList.remove('open'));
}

// ===== Unified Search: Companies + Users =====
const searchInput = document.getElementById('searchInput');
const list = document.getElementById('companiesList');
const items = list ? Array.from(list.querySelectorAll('.company-card-link')) : [];

// --- helpers for highlighting ---
function normalizeText(el) {
  // restore original visible text by stripping previous <mark>
  if (!el) return;
  el.innerHTML = el.textContent;
}
function highlightTextInElement(el, term) {
  if (!el) return;
  const text = el.textContent;
  const q = String(term || "").trim();
  if (!q) { normalizeText(el); return; }
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) { normalizeText(el); return; }
  const before = text.slice(0, idx);
  const match  = text.slice(idx, idx + q.length);
  const after  = text.slice(idx + q.length);
  el.innerHTML = `${before}<mark class="hl">${match}</mark>${after}`;
}

// --- filter dashboard company cards ---
function filterCompanies(q) {
  if (!items.length) return;
  items.forEach(a => {
    const titleEl = a.querySelector('.company-value');
    if (!titleEl) return;
    normalizeText(titleEl);
    const text = titleEl.textContent.toLowerCase();
    const hit = text.includes(q);
    a.style.display = (!q || hit) ? 'block' : 'none';
    if (q && hit) highlightTextInElement(titleEl, q);
  });
}

// --- filter users table rows (name, email, role, companies) ---
function filterUsers(q) {
  const tbody = document.getElementById('usersTbody');
  if (!tbody) return;

  // for each row, check 4 columns and optionally highlight each cell
  Array.from(tbody.querySelectorAll('tr')).forEach(row => {
    const nameCell  = row.cells[0]; // Name
    const emailCell = row.cells[1]; // Email
    const roleCell  = row.cells[2]; // Role
    const compsCell = row.cells[3]; // Status/Companies

    const name  = (nameCell?.textContent || "").toLowerCase();
    const email = (emailCell?.textContent || "").toLowerCase();
    const role  = (roleCell?.textContent || "").toLowerCase();
    const comps = (compsCell?.textContent || "").toLowerCase();

    const combined = `${name} ${email} ${role} ${comps}`;
    const hit = combined.includes(q);

    // show/hide row
    row.style.display = (!q || hit) ? '' : 'none';

    // clear previous highlights
    [nameCell, emailCell, roleCell, compsCell].forEach(normalizeText);

    // apply highlights when matched
    if (q && hit) {
      highlightTextInElement(nameCell, q);
      highlightTextInElement(emailCell, q);
      highlightTextInElement(roleCell, q);
      highlightTextInElement(compsCell, q);
    }
  });
}

// --- wire the single search box to both views ---
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    filterCompanies(q);
    filterUsers(q);
  });
}


if (searchInput && items.length) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    items.forEach(a => {
      const titleEl = a.querySelector('.company-value');
      if (!titleEl) return;
      normalizeText(titleEl);
      const text = titleEl.textContent.toLowerCase();
      const hit = text.includes(q);
      a.style.display = (!q || hit) ? 'block' : 'none';
      if (q && hit) highlight(titleEl, q);
    });
  });
}


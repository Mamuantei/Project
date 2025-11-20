// app.js - client SPA (vanilla JS)
const API_ROOT = ''; // same origin
let token = localStorage.getItem('taskearn_token') || null;
let currentUser = null;
const view = document.getElementById('view');
const balanceDisplay = document.getElementById('balanceDisplay');
const btnLogin = document.getElementById('btnLogin');
const modal = document.getElementById('modal');
const modalCard = document.getElementById('modalCard');
const toastEl = document.getElementById('toast');

function showToast(msg, timeout=3000){
  toastEl.style.display = 'block';
  toastEl.textContent = msg;
  setTimeout(()=> toastEl.style.display = 'none', timeout);
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  if(token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_ROOT + path, {...opts, headers});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) {
    throw data;
  }
  return data;
}

async function loadProfile(){
  if(!token) {
    currentUser = null;
    balanceDisplay.textContent = '₹0.00';
    btnLogin.textContent = 'Sign in';
    return;
  }
  try {
    const { user } = await api('/api/profile', { method: 'GET' });
    currentUser = user;
    balanceDisplay.textContent = `₹${Number(user.balance||0).toFixed(2)}`;
    btnLogin.textContent = user.username + ' (Log out)';
  } catch (e) {
    console.warn('auth failed', e);
    logoutLocal();
  }
}

function logoutLocal(){
  token = null;
  currentUser = null;
  localStorage.removeItem('taskearn_token');
  btnLogin.textContent = 'Sign in';
  balanceDisplay.textContent = '₹0.00';
  navigateTo('#/home');
}

btnLogin.addEventListener('click', () => {
  if(token) {
    if(confirm('Sign out?')) logoutLocal();
    return;
  }
  openAuthModal();
});

// Auth modal
function openAuthModal(){
  modal.style.display = 'flex';
  modalCard.innerHTML = `
    <h3>Sign in / Register</h3>
    <div style="margin-top:12px;display:flex;gap:8px">
      <input id="authUser" placeholder="username" class="input" />
      <input id="authPass" type="password" placeholder="password" class="input" />
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button id="doLogin" class="btn primary">Sign in</button>
      <button id="doRegister" class="btn">Register</button>
      <button id="closeModal" class="btn">Close</button>
    </div>
    <div class="small-muted" style="margin-top:10px">Demo: admin/admin123 is an admin.</div>
  `;
  document.getElementById('closeModal').onclick = closeModal;
  document.getElementById('doLogin').onclick = async () => {
    const u = document.getElementById('authUser').value.trim();
    const p = document.getElementById('authPass').value;
    if(!u || !p) return alert('enter credentials');
    try {
      const res = await fetch('/api/auth/login', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if(!res.ok) throw data;
      token = data.token;
      localStorage.setItem('taskearn_token', token);
      await loadProfile();
      showToast('Signed in');
      closeModal();
      navigateTo('#/tasks');
    } catch (err) {
      alert(err.error || 'login failed');
    }
  };
  document.getElementById('doRegister').onclick = async () => {
    const u = document.getElementById('authUser').value.trim();
    const p = document.getElementById('authPass').value;
    if(!u || !p) return alert('enter credentials');
    try {
      const res = await fetch('/api/auth/register', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if(!res.ok) throw data;
      token = data.token;
      localStorage.setItem('taskearn_token', token);
      await loadProfile();
      showToast('Registered & signed in');
      closeModal();
      navigateTo('#/tasks');
    } catch (err) {
      alert(err.error || 'register failed');
    }
  };
}

function closeModal(){
  modal.style.display = 'none';
  modalCard.innerHTML = '';
}

// Router
function navigateTo(hash) {
  window.location.hash = hash;
  route();
}

async function route(){
  const hash = window.location.hash || '#/home';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.route === hash));
  if(hash === '#/home'){
    renderHome();
  } else if (hash === '#/tasks'){
    await renderTasks();
  } else if (hash === '#/submit'){
    renderSubmit();
  } else if (hash === '#/account'){
    renderAccount();
  } else {
    renderHome();
  }
}

window.addEventListener('hashchange', route);

// --- Views ---

function renderHome(){
  document.title = 'Home — TaskEarn';
  view.innerHTML = `
    <div class="view-card hero">
      <div class="left">
        <h1>Earn money by doing tasks — daily.</h1>
        <p class="small-muted">Complete simple microtasks and receive rewards immediately after approval. Upload proofs, refer friends, and level up your earnings.</p>
        <div class="cta">
          <button id="ctaTasks" class="btn primary">Browse Tasks</button>
          <button id="ctaHow" class="btn">How it Works</button>
        </div>
        <div style="margin-top:12px" class="small-muted">Secure, fast, and luxury experience — payments in INR (demo).</div>
      </div>
      <div class="hero-visual">₹</div>
    </div>

    <div class="view-card" style="margin-top:16px">
      <h3>Why TaskEarn?</h3>
      <p class="small-muted">High-quality tasks. Fast review by admin. Transparent balances. Withdraw anytime (requests processed by admin).</p>
    </div>
  `;

  document.getElementById('ctaTasks').onclick = () => navigateTo('#/tasks');
  document.getElementById('ctaHow').onclick = () => {
    alert('How it works: Sign up → Take tasks → Upload proof → Admin reviews → Balance credited → Request withdraw.');
  };
}

async function renderTasks(){
  document.title = 'Tasks — TaskEarn';
  view.innerHTML = `<div class="view-card"><h2>Available Tasks</h2><div id="tasksGrid" class="tasks-grid small-muted">Loading...</div></div>`;
  try {
    const data = await api('/api/tasks', { method: 'GET' });
    const tasks = data.tasks || [];
    const grid = document.getElementById('tasksGrid');
    if(tasks.length === 0) {
      grid.innerHTML = '<div class="small-muted">No tasks yet.</div>';
      return;
    }
    grid.innerHTML = '';
    tasks.forEach(t => {
      const tags = t.tags ? t.tags.split(',').filter(Boolean) : [];
      const el = document.createElement('div');
      el.className = 'task-card';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3>${escapeHtml(t.title)}</h3>
          <div class="tag">₹${Number(t.reward||0).toFixed(2)}</div>
        </div>
        <p class="small-muted">${escapeHtml(t.description)}</p>
        <div class="task-meta">
          <div>${tags.map(x=>`<span class="tag">${escapeHtml(x)}</span>`).join(' ')}</div>
          <div class="task-actions">
            <button class="btn" data-id="${t.id}" data-take>Details</button>
            <button class="btn primary" data-id="${t.id}" data-take>${t.status === 'open' ? 'Take Task' : (t.status === 'assigned' ? 'Assigned' : 'Status')}</button>
          </div>
        </div>
      `;
      // take/take click handler
      el.querySelectorAll('[data-take]').forEach(b => {
        b.addEventListener('click', async (ev) => {
          const id = b.getAttribute('data-id');
          if(!token){
            if(confirm('Sign in to take task?')) openAuthModal();
            return;
          }
          // call take endpoint
          try {
            const res = await fetch(`/api/tasks/${id}/take`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            if(!res.ok) throw data;
            showToast('Task accepted. Go to Submit page to upload proof.');
            // prefill submit with task
            sessionStorage.setItem('prefill_task', id);
            navigateTo('#/submit');
          } catch (err) {
            alert(err.error || 'could not take task');
          }
        });
      });
      grid.appendChild(el);
    });
  } catch (err) {
    console.error(err);
    document.getElementById('tasksGrid').innerHTML = `<div class="small-muted">Failed to load tasks.</div>`;
  }
}

function renderSubmit(){
  document.title = 'Submit — TaskEarn';
  const prefill = sessionStorage.getItem('prefill_task') || '';
  view.innerHTML = `
    <div class="view-card">
      <h2>Submit Task</h2>
      <form id="submitForm" class="submit-form">
        <label>Task ID</label>
        <input id="taskId" class="input" value="${escapeHtml(prefill)}" required />
        <label>Message / Notes</label>
        <textarea id="message" class="input"></textarea>
        <label>Upload files (screenshots, proof) — max 5 files</label>
        <input id="files" type="file" multiple />
        <div style="display:flex;gap:8px;margin-top:12px">
          <button type="submit" class="btn primary">Submit</button>
          <button type="button" id="cancelSubmit" class="btn">Cancel</button>
        </div>
      </form>
      <div id="submitStatus" class="small-muted" style="margin-top:10px"></div>
    </div>
  `;
  document.getElementById('cancelSubmit').onclick = () => navigateTo('#/tasks');

  document.getElementById('submitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if(!token) { openAuthModal(); return; }
    const taskId = document.getElementById('taskId').value.trim();
    if(!taskId) return alert('Enter task id');
    const filesInput = document.getElementById('files');
    const files = filesInput.files;
    if(files.length === 0) {
      if(!confirm('No files uploaded. Continue?')) return;
    }
    const msg = document.getElementById('message').value.trim();
    const form = new FormData();
    form.append('task_id', taskId);
    form.append('message', msg);
    for(let i=0;i<files.length && i<5;i++) form.append('files', files[i]);

    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: form
      });
      const data = await res.json();
      if(!res.ok) throw data;
      document.getElementById('submitStatus').textContent = 'Successfully submitted — awaiting admin review.';
      showToast('Successfully submitted');
      // clear prefill
      sessionStorage.removeItem('prefill_task');
    } catch (err) {
      console.error(err);
      alert(err.error || 'submission failed');
    }
  });
}

async function renderAccount(){
  document.title = 'Account — TaskEarn';
  if(!token) {
    view.innerHTML = `<div class="view-card"><h2>Account</h2><p class="small-muted">Sign in to view your account.</p></div>`;
    return;
  }
  try {
    const { user } = await api('/api/profile', { method: 'GET' });
    view.innerHTML = `
      <div class="view-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:12px;align-items:center">
            <div class="avatar">${escapeHtml(user.username.slice(0,2)).toUpperCase()}</div>
            <div>
              <div style="font-weight:700">${escapeHtml(user.username)}</div>
              <div class="small-muted">Member since ${new Date(user.created_at).toLocaleDateString()}</div>
            </div>
          </div>
          <div style="text-align:right">
            <div class="small-muted">Balance</div>
            <div style="font-weight:700;color:var(--accent)">₹${Number(user.balance||0).toFixed(2)}</div>
          </div>
        </div>

        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="btnWithdraw" class="btn">Withdraw</button>
          <button id="btnAddFunds" class="btn primary">Add Funds</button>
          <button id="btnContact" class="btn">Customer Service</button>
          <button id="btnLogout" class="btn">Log out</button>
        </div>

        <div id="accountArea" style="margin-top:18px"></div>
      </div>
    `;

    document.getElementById('btnLogout').onclick = () => {
      if(confirm('Log out?')) {
        logoutLocal();
      }
    };

    document.getElementById('btnContact').onclick = () => {
      openContactModal();
    };

    document.getElementById('btnWithdraw').onclick = async () => {
      const amt = prompt('Enter amount to withdraw (₹)');
      if(!amt) return;
      if(isNaN(Number(amt)) || Number(amt) <= 0) return alert('Invalid amount');
      try {
        const res = await fetch('/api/withdraw', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ amount: Number(amt) })
        });
        const data = await res.json();
        if(!res.ok) throw data;
        showToast('Withdraw request created. Admin will process it.');
        await loadProfile();
        renderAccount();
      } catch (err) {
        alert(err.error || 'withdraw failed');
      }
    };

    document.getElementById('btnAddFunds').onclick = async () => {
      const amt = prompt('Enter amount to add (₹)');
      if(!amt) return;
      try {
        const res = await fetch('/api/stripe/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
          body: JSON.stringify({ amount: Number(amt) })
        });
        const data = await res.json();
        if(!res.ok) throw data;
        // redirect to stripe checkout
        window.location.href = data.url;
      } catch (err) {
        alert(err.error || 'could not start checkout');
      }
    };

  } catch (err) {
    console.error(err);
    alert('Failed to load account');
  }
}

// small helper
function escapeHtml(s){ if(!s) return ''; return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// load profile on start
(async ()=>{
  await loadProfile();
  route();
})();

// basic api helper that uses bearer token and handles json
async function api(path, opts={}) {
  const headers = opts.headers || {};
  if(!opts.headers) opts.headers = headers;
  if(!headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if(token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw data;
  return data;
}

function openContactModal(){
  modal.style.display = 'flex';
  modalCard.innerHTML = `
    <h3>Contact Customer Service</h3>
    <div style="margin-top:8px">
      <div class="small-muted">Email: <a href="mailto:support@example.com">support@example.com</a></div>
      <div class="small-muted">Phone: +91-99999-99999</div>
      <div style="margin-top:12px;"><button id="closeContact" class="btn">Close</button></div>
    </div>
  `;
  document.getElementById('closeContact').onclick = () => { modal.style.display = 'none'; modalCard.innerHTML = ''; };
}

// close modal when clicking backdrop
modal.addEventListener('click', (e) => { if(e.target === modal) { modal.style.display = 'none'; modalCard.innerHTML = ''; } });
        

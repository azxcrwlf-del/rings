/**
 * ADMIN AUTHENTICATION SYSTEM
 * Simple password gate for admin access
 */

class AdminAuth {
  constructor() {
    this.ADMIN_PASSWORD = 'ALI2026'; // PASSWORD SET
    this.AUTH_KEY = 'adminAuth';
    this.SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    this.init();
  }

  init() {
    // Check if already authenticated
    if (this.isAuthenticated()) {
      this.showAdmin();
      return;
    }

    // Show login gate
    this.showGate();
  }

  isAuthenticated() {
    const auth = localStorage.getItem(this.AUTH_KEY);
    if (!auth) return false;

    const [password, timestamp] = auth.split('|');
    const now = Date.now();
    const elapsed = now - parseInt(timestamp);

    // Session expired after 24 hours
    if (elapsed > this.SESSION_DURATION) {
      localStorage.removeItem(this.AUTH_KEY);
      return false;
    }

    return password === this.ADMIN_PASSWORD;
  }

  showGate() {
    const gate = document.getElementById('admin-gate');
    if (!gate) return;

    gate.classList.add('show');

    // Find password input and button
    const input = gate.querySelector('input[type="password"]');
    const primaryBtn = gate.querySelector('.gate-actions .primary');
    const secondaryBtn = gate.querySelector('.gate-actions .secondary');
    const errorMsg = gate.querySelector('.gate-error');

    if (primaryBtn) {
      primaryBtn.addEventListener('click', () => this.authenticate(input, errorMsg));
    }

    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.authenticate(input, errorMsg);
      });
    }

    if (secondaryBtn) {
      secondaryBtn.addEventListener('click', () => this.closeGate());
    }
  }

  authenticate(input, errorMsg) {
    if (!input) return;

    const password = input.value.trim();

    if (password === this.ADMIN_PASSWORD) {
      // Save auth with timestamp
      localStorage.setItem(this.AUTH_KEY, `${password}|${Date.now()}`);
      this.showAdmin();
      this.closeGate();
      input.value = '';
      if (errorMsg) errorMsg.style.display = 'none';
    } else {
      if (errorMsg) {
        errorMsg.textContent = 'كلمة المرور غير صحيحة';
        errorMsg.style.display = 'block';
      }
      input.value = '';
      input.focus();
    }
  }

  showAdmin() {
    const admin = document.getElementById('admin');
    if (admin) {
      admin.classList.add('active');
    }
  }

  closeGate() {
    const gate = document.getElementById('admin-gate');
    if (gate) {
      gate.classList.remove('show');
    }
  }

  logout() {
    localStorage.removeItem(this.AUTH_KEY);
    location.reload();
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.adminAuth = new AdminAuth();
});

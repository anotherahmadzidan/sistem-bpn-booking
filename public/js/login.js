/* Logika halaman login. Dipindah dari public/pages/login.html supaya
   bisa di-lint, di-cache browser, dan di-review terpisah dari markup.
   Skrip klasik (bukan module) agar fungsi tetap global untuk onclick="...". */

// Redirect kalau sudah login
if (localStorage.getItem('token') && localStorage.getItem('role') === 'user') {
  window.location.href = '/user';
}

const authForms = ['form-login', 'form-register', 'form-verify', 'form-complete', 'form-forgot', 'form-reset'];
let resendCountdownTimer = null;
let resendAvailableAt = 0;
let registrationCompletionToken = sessionStorage.getItem('registration_completion_token') || '';

function showAuthForm(formId) {
  authForms.forEach(id => {
    document.getElementById(id).style.display = id === formId ? 'block' : 'none';
  });
}

function hideAlerts(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  });
}

function showAlert(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.style.display = 'block';
}

function setButtonBusy(button, busy, text) {
  return AppAsync.setButtonLoading(button, busy, text);
}

function normalizeOtpInput(inputId) {
  const input = document.getElementById(inputId);
  input.value = input.value.replace(/\D/g, '').slice(0, 6);
  return input.value;
}

function showRegister() {
  hideAlerts('login-error', 'login-success', 'register-error', 'register-success', 'complete-error', 'complete-success');
  registrationCompletionToken = '';
  sessionStorage.removeItem('registration_completion_token');
  sessionStorage.removeItem('registration_completion_email');
  showAuthForm('form-register');
}

function showLogin() {
  hideAlerts('register-error', 'register-success', 'verify-error', 'verify-success', 'forgot-error', 'forgot-success', 'reset-error', 'reset-success');
  showAuthForm('form-login');
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function renderResendCountdown() {
  const button = document.getElementById('verify-resend-btn');
  const status = document.getElementById('verify-resend-status');
  const remaining = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));

  if (remaining > 0) {
    button.disabled = true;
    status.textContent = `Kirim ulang tersedia dalam ${formatCountdown(remaining)}`;
    return;
  }

  button.disabled = false;
  status.textContent = 'Tidak menerima kode? Anda dapat mengirim ulang OTP.';
  if (resendCountdownTimer) {
    clearInterval(resendCountdownTimer);
    resendCountdownTimer = null;
  }
}

function startResendCountdown(seconds) {
  const remaining = Math.max(0, Number(seconds) || 0);
  resendAvailableAt = Date.now() + (remaining * 1000);
  if (resendCountdownTimer) clearInterval(resendCountdownTimer);
  renderResendCountdown();
  if (remaining > 0) {
    resendCountdownTimer = setInterval(renderResendCountdown, 1000);
  }
}

function showVerify(email, verificationState = {}) {
  hideAlerts('login-error', 'login-success', 'register-error', 'register-success', 'verify-error', 'verify-success');
  if (email) document.getElementById('verify-email').value = email;
  document.getElementById('verify-otp').value = '';
  showAuthForm('form-verify');
  startResendCountdown(verificationState.resend_available_in_seconds || 0);
}

function showCompleteProfile(data = {}) {
  const token = data.registration_token || registrationCompletionToken;
  const email = data.email || sessionStorage.getItem('registration_completion_email') || '';
  if (!token || !email) {
    showRegister();
    showAlert('register-error', 'Sesi verifikasi tidak ditemukan. Masukkan kembali email Anda.');
    return;
  }

  registrationCompletionToken = token;
  sessionStorage.setItem('registration_completion_token', token);
  sessionStorage.setItem('registration_completion_email', email);
  document.getElementById('complete-email').value = email;
  hideAlerts('verify-error', 'verify-success', 'complete-error', 'complete-success');
  showAuthForm('form-complete');
}

function enterUserPage(data) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('nama', data.nama);
  localStorage.setItem('role', data.role);
  sessionStorage.removeItem('registration_completion_token');
  sessionStorage.removeItem('registration_completion_email');
  registrationCompletionToken = '';
  window.location.href = '/user';
}

function followRegistrationStatus(data, fallbackEmail) {
  if (data.status === 'pending_profile_completion') {
    showCompleteProfile(data);
    return true;
  }
  if (data.status === 'pending_email_verification') {
    showVerify(data.email || fallbackEmail, data);
    showAlert('verify-success', data.message || 'Masukkan kode OTP dari email Anda.');
    return true;
  }
  if (data.status === 'active') {
    if (data.token) {
      enterUserPage(data);
      return true;
    }
    showLogin();
    showAlert('login-error', data.message || 'Email sudah terdaftar. Silakan masuk.');
    return true;
  }
  return false;
}

function showForgotPassword() {
  hideAlerts('login-error', 'login-success', 'forgot-error', 'forgot-success');
  const identifier = document.getElementById('identifier').value.trim();
  if (identifier.includes('@')) {
    document.getElementById('forgot-email').value = identifier;
  }
  showAuthForm('form-forgot');
}

function showResetPassword(email) {
  hideAlerts('forgot-error', 'forgot-success', 'reset-error', 'reset-success');
  if (email) document.getElementById('reset-email').value = email;
  document.getElementById('reset-otp').value = '';
  document.getElementById('reset-password').value = '';
  showAuthForm('form-reset');
}

// Fungsi tambahan untuk toggle mata password
function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
  } else {
    input.type = "password";
  }
}

async function login(button) {
  const identifier = document.getElementById('identifier').value.trim();
  const password = document.getElementById('password').value;
  hideAlerts('login-error', 'login-success');

  if (!identifier || !password) {
    showAlert('login-error', 'Email dan kata sandi wajib diisi');
    return;
  }
  if (!setButtonBusy(button, true, 'Memproses...')) return;
  try {
    const res = await AppAsync.fetchWithTimeout('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 403 && data.code === 'EMAIL_NOT_VERIFIED') {
        showVerify(data.email || identifier, data);
        showAlert('verify-error', data.message || 'Email belum diverifikasi.');
        return;
      }
      showAlert('login-error', data.message);
      return;
    }
    localStorage.setItem('token', data.token);
    localStorage.setItem('nama', data.nama);
    localStorage.setItem('role', data.role);
    window.location.href = '/user';
  } catch (error) {
    showAlert('login-error', AppAsync.errorMessage(error, 'Login gagal. Silakan coba lagi.'));
  } finally {
    setButtonBusy(button, false);
  }
}

async function register(button) {
  const email = document.getElementById('reg-email').value.trim();
  hideAlerts('register-error', 'register-success');

  if (!email) {
    showAlert('register-error', 'Email wajib diisi');
    return;
  }
  if (!setButtonBusy(button, true, 'Mengirim OTP...')) return;
  try {
    const res = await AppAsync.fetchWithTimeout('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.status === 'active') {
        followRegistrationStatus(data, email);
        return;
      }
      showAlert('register-error', data.message);
      return;
    }
    if (!followRegistrationStatus(data, email)) {
      showAlert('register-error', 'Status pendaftaran tidak dikenali. Silakan coba lagi.');
    }
  } catch (error) {
    showAlert('register-error', AppAsync.errorMessage(error, 'Registrasi gagal. Silakan coba lagi.'));
  } finally {
    setButtonBusy(button, false);
  }
}

async function verifyEmailOtp(button) {
  const email = document.getElementById('verify-email').value.trim();
  const otp = normalizeOtpInput('verify-otp');
  hideAlerts('verify-error', 'verify-success');

  if (!email || !otp) {
    showAlert('verify-error', 'Email dan kode OTP wajib diisi');
    return;
  }

  if (!setButtonBusy(button, true, 'Memverifikasi...')) return;
  try {
    const res = await AppAsync.fetchWithTimeout('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    const data = await res.json();
    if (!res.ok) {
      showAlert('verify-error', data.message || 'Verifikasi gagal');
      return;
    }
    if (followRegistrationStatus(data, email)) {
      return;
    }
    if (data.token) {
      enterUserPage(data);
      return;
    }
    showLogin();
    showAlert('login-success', data.message || 'Email berhasil diverifikasi. Silakan login.');
  } catch (error) {
    showAlert('verify-error', AppAsync.errorMessage(error, 'Verifikasi gagal. Silakan coba lagi.'));
  } finally {
    setButtonBusy(button, false);
  }
}

async function completeRegistration(button) {
  const nama_lengkap = document.getElementById('reg-nama').value.trim();
  const phoneResult = PhoneValidation.validateInput(
    'reg-hp',
    'reg-hp-feedback',
    { showEmpty: true }
  );
  const password = document.getElementById('reg-password').value;
  hideAlerts('complete-error', 'complete-success');

  if (!registrationCompletionToken) {
    showAlert('complete-error', 'Sesi pendaftaran tidak ditemukan. Masukkan kembali email Anda.');
    return;
  }
  if (!nama_lengkap || !document.getElementById('reg-hp').value.trim() || !password) {
    showAlert('complete-error', 'Semua data diri wajib diisi');
    return;
  }
  if (!phoneResult.valid) {
    showAlert('complete-error', phoneResult.message);
    return;
  }
  if (password.length < 8) {
    showAlert('complete-error', 'Kata sandi minimal 8 karakter');
    return;
  }

  if (!setButtonBusy(button, true, 'Membuat Akun...')) return;
  try {
    const res = await AppAsync.fetchWithTimeout('/api/auth/complete-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_token: registrationCompletionToken,
        nama_lengkap,
        no_hp: phoneResult.normalized,
        password
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showAlert('complete-error', data.message || 'Pendaftaran gagal diselesaikan');
      if (data.code === 'REGISTRATION_TOKEN_EXPIRED' || data.code === 'REGISTRATION_SESSION_EXPIRED') {
        registrationCompletionToken = '';
        sessionStorage.removeItem('registration_completion_token');
      }
      return;
    }
    enterUserPage(data);
  } catch (error) {
    showAlert('complete-error', AppAsync.errorMessage(error, 'Pendaftaran gagal diselesaikan.'));
  } finally {
    setButtonBusy(button, false);
  }
}

async function resendVerificationOtp(button) {
  const email = document.getElementById('verify-email').value.trim();
  hideAlerts('verify-error', 'verify-success');

  if (!email) {
    showAlert('verify-error', 'Email wajib diisi untuk mengirim ulang OTP');
    return;
  }

  if (!setButtonBusy(button, true, 'Mengirim...')) return;
  let nextCountdown = null;
  try {
    const res = await AppAsync.fetchWithTimeout('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'OTP_COOLDOWN') {
        nextCountdown = data.retry_after_seconds || 0;
      }
      showAlert('verify-error', data.message || 'Gagal mengirim OTP');
      return;
    }
    nextCountdown = data.resend_available_in_seconds || 0;
    showAlert('verify-success', data.message || 'Kode OTP baru telah dikirim.');
  } catch (error) {
    showAlert('verify-error', AppAsync.errorMessage(error, 'OTP gagal dikirim. Silakan coba lagi.'));
  } finally {
    setButtonBusy(button, false);
    if (nextCountdown !== null) startResendCountdown(nextCountdown);
  }
}

async function requestPasswordReset(button) {
  const email = document.getElementById('forgot-email').value.trim();
  hideAlerts('forgot-error', 'forgot-success');

  if (!email) {
    showAlert('forgot-error', 'Email wajib diisi');
    return;
  }

  if (!setButtonBusy(button, true, 'Mengirim OTP...')) return;
  try {
    const res = await AppAsync.fetchWithTimeout('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      showAlert('forgot-error', data.message || 'Gagal mengirim OTP reset');
      return;
    }
    showResetPassword(email);
    showAlert('reset-success', data.message || 'Kode OTP reset telah dikirim ke email.');
  } catch (error) {
    showAlert('forgot-error', AppAsync.errorMessage(error, 'OTP reset gagal dikirim.'));
  } finally {
    setButtonBusy(button, false);
  }
}

async function submitPasswordReset(button) {
  const email = document.getElementById('reset-email').value.trim();
  const otp = normalizeOtpInput('reset-otp');
  const password = document.getElementById('reset-password').value;
  hideAlerts('reset-error', 'reset-success');

  if (!email || !otp || !password) {
    showAlert('reset-error', 'Email, OTP, dan kata sandi baru wajib diisi');
    return;
  }

  if (!setButtonBusy(button, true, 'Menyimpan...')) return;
  try {
    const res = await AppAsync.fetchWithTimeout('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, password })
    });
    const data = await res.json();
    if (!res.ok) {
      showAlert('reset-error', data.message || 'Gagal mengubah kata sandi');
      return;
    }
    document.getElementById('password').value = '';
    document.getElementById('identifier').value = email;
    showLogin();
    showAlert('login-success', data.message || 'Kata sandi berhasil diubah. Silakan login.');
  } catch (error) {
    showAlert('reset-error', AppAsync.errorMessage(error, 'Kata sandi gagal diubah.'));
  } finally {
    setButtonBusy(button, false);
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const visibleForm = authForms.find(id => document.getElementById(id).style.display !== 'none');
    if (visibleForm === 'form-login') login(document.querySelector('#form-login .btn-masuk'));
    if (visibleForm === 'form-register') register(document.querySelector('#form-register .btn-daftar'));
    if (visibleForm === 'form-verify') verifyEmailOtp(document.querySelector('#form-verify .btn-masuk'));
    if (visibleForm === 'form-complete') completeRegistration(document.querySelector('#form-complete .btn-daftar'));
    if (visibleForm === 'form-forgot') requestPasswordReset(document.querySelector('#form-forgot .btn-masuk'));
    if (visibleForm === 'form-reset') submitPasswordReset(document.querySelector('#form-reset .btn-daftar'));
  }
});

if (registrationCompletionToken && sessionStorage.getItem('registration_completion_email')) {
  showCompleteProfile();
}
PhoneValidation.bind('reg-hp', 'reg-hp-feedback');

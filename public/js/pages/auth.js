// Login and registration pages.
import { $, view, api, toast, formData, state } from '../core.js';

export function authForm(kind) {
  const reg = kind === 'register';
  view.innerHTML = `<div class="card narrow"><h1>${reg ? 'Create account' : 'Welcome back'}</h1>
    <form id="f">
      ${reg ? '<label>Full name<input name="name" required maxlength="80"></label>' : ''}
      <label>Email<input type="email" name="email" required></label>
      <label>Password${reg ? ' (min 8 characters)' : ''}<input type="password" name="password" required minlength="${reg ? 8 : 1}"></label>
      ${reg ? '<label>Mobile (for SMS alerts)<input name="phone" placeholder="09171234567"></label><label>City / municipality<input name="city" placeholder="Quezon City"></label>' : ''}
      <div class="err" id="e"></div><button>${reg ? 'Register' : 'Log in'}</button>
    </form>
    <p class="small mut">${reg ? 'Already registered? <a href="#/login">Log in</a>' : 'No account? <a href="#/register">Register</a>'}</p></div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { state.me = (await api('/auth/' + kind, { method: 'POST', body: formData(ev.target) })).user; toast('Welcome, ' + state.me.name); location.hash = state.me.role === 'admin' ? '#/admin' : '#/'; }
    catch (e) { $('#e').textContent = e.message; }
  };
}
export function loginPage() { return authForm('login'); }
export function registerPage() { return authForm('register'); }

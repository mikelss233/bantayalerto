// Each user's preparedness checklist.
import { $, view, esc, api, formData } from '../core.js';

export async function checklistPage() {
  view.innerHTML = '<h1>My preparedness checklist</h1><div class="card narrow" style="max-width:640px;margin:0"><div class="bar"><i id="pb"></i></div><p class="small mut" id="pt"></p><ul class="clean check" id="l"></ul>' +
    '<form class="row" id="f"><input class="grow" name="item" placeholder="Add your own item" required maxlength="200"><button>Add</button></form></div>';
  let items = [];
  const draw = () => {
    const done = items.filter((i) => i.done).length;
    $('#pb').style.width = (items.length ? done / items.length * 100 : 0) + '%'; $('#pt').textContent = `${done} of ${items.length} ready`;
    $('#l').innerHTML = items.map((i) => `<li class="${i.done ? 'done' : ''}"><input type="checkbox" data-id="${i.id}" ${i.done ? 'checked' : ''}><span class="grow">${esc(i.item)}</span><button class="sm sec" data-del="${i.id}">✕</button></li>`).join('');
  };
  items = await api('/checklist'); draw();
  $('#l').onchange = async (e) => { const it = items.find((i) => i.id == e.target.dataset.id); it.done = e.target.checked ? 1 : 0; await api('/checklist/' + it.id, { method: 'PUT', body: { done: e.target.checked } }); draw(); };
  $('#l').onclick = async (e) => { const id = e.target.dataset.del; if (id) { await api('/checklist/' + id, { method: 'DELETE' }); items = items.filter((i) => i.id != id); draw(); } };
  $('#f').onsubmit = async (e) => { e.preventDefault(); items.push(await api('/checklist', { method: 'POST', body: formData(e.target) })); e.target.reset(); draw(); };
}

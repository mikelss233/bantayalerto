const { Router } = require('express');
const { requireAuth } = require('../auth');
const { HttpError, str } = require('../util');

module.exports = (db) => {
  const r = Router();
  r.use(requireAuth);
  const own = (req) => {
    const row = db.prepare('SELECT * FROM checklist_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) throw new HttpError(404, 'Item not found');
    return row;
  };
  r.get('/', (req, res) => res.json(db.prepare('SELECT * FROM checklist_items WHERE user_id = ? ORDER BY id').all(req.user.id)));
  r.post('/', (req, res) => {
    const item = str(req.body.item, 200);
    if (!item) throw new HttpError(400, 'Item text is required');
    const info = db.prepare('INSERT INTO checklist_items (user_id, item) VALUES (?, ?)').run(req.user.id, item);
    res.status(201).json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(info.lastInsertRowid));
  });
  r.put('/:id', (req, res) => {
    const row = own(req);
    db.prepare('UPDATE checklist_items SET done = ?, item = ? WHERE id = ?')
      .run(req.body.done === undefined ? row.done : req.body.done ? 1 : 0, str(req.body.item, 200) || row.item, row.id);
    res.json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(row.id));
  });
  r.delete('/:id', (req, res) => { own(req); db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
  return r;
};

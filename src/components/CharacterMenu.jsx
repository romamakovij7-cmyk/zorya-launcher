import { createPortal } from 'react-dom';
import { CloseIcon } from './Icons.jsx';

// Правый клик по персонажу (главный экран и «Skins»): что настроить. Выбор открывает своё окно; само меню закрывается.
const CHOICES = [
  { id: 'gender', title: 'Female Gender Mod', sub: 'Gender, breasts and their physics, voice' },
  { id: 'fresh', title: 'Fresh Moves', sub: 'Eyes and eyebrows skin, animation; the pack is installed in the builds automatically' },
];

export default function CharacterMenu({ account, onPick, onClose }) {
  return createPortal((
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal char-menu" onClick={(e) => e.stopPropagation()}>
        <div className="customize-modal-header">
          <h2>Настроить персонажа</h2>
          <button className="icon-btn" onClick={onClose}><CloseIcon /></button>
        </div>
        <p className="hint-text gender-sub">{account ? `${account.name}: ` : ''}выберите, что настроить.</p>
        <div className="char-menu-list">
          {CHOICES.map((c) => (
            <button key={c.id} className="char-menu-card" onClick={() => onPick(c.id)}>
              <span className="char-menu-title">{c.title}</span>
              <span className="char-menu-sub">{c.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
}

import { useRef, useState } from 'react';
import {
  HomeIcon, SearchIcon, LibraryIcon, SettingsIcon, UserIcon, ShirtIcon, CameraIcon, LayersIcon, BarChartIcon,
} from './Icons.jsx';
import AccountFace from './AccountFace.jsx';
import PremiumButton from './PremiumButton.jsx';
import AccountSwitcher from './AccountSwitcher.jsx';
import { useOrder } from '../utils/useOrder.js';

export default function Sidebar({
  page, onNavigate, account, onAccountChange, showBuilderTools, showStats, showSearch = true,
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const avatarRef = useRef(null);

  // Icons can be dragged to change their order (saved in settings).
  const items = {
    home: { title: 'Home', Icon: HomeIcon, visible: true },
    search: { title: 'Search', Icon: SearchIcon, visible: showSearch },
    library: { title: 'Library', Icon: LibraryIcon, visible: true },
    skins: { title: 'Skins', Icon: ShirtIcon, visible: true },
    screenshots: { title: 'Screenshots', Icon: CameraIcon, visible: true },
    stats: { title: 'Stats', Icon: BarChartIcon, visible: showStats },
    schematics: { title: 'Schematics', Icon: LayersIcon, visible: showBuilderTools },
  };
  const { order, itemProps } = useOrder('sidebarOrder', Object.keys(items));

  return (
    <div className="sidebar">
      <div className="sidebar-avatar-wrap">
        <button ref={avatarRef} className="sidebar-avatar" onClick={() => setSwitcherOpen((v) => !v)} title={account ? account.name : 'Аккаунты'}>
          <AccountFace account={account} size={52} />
        </button>
        {switcherOpen && (
          <AccountSwitcher
            anchorRef={avatarRef}
            onClose={() => setSwitcherOpen(false)}
            onActiveAccountChange={(a) => { onAccountChange(a); }}
          />
        )}
      </div>

      {order.map((id) => {
        const item = items[id];
        if (!item.visible) return null;
        const Icon = item.Icon;
        return (
          <button
            key={id}
            className={`sidebar-icon ${page === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
            title={item.title}
            {...itemProps(id)}
          >
            <Icon />
          </button>
        );
      })}

      <div className="sidebar-spacer" />

      <PremiumButton variant="side" />
      <button className={`sidebar-icon ${page === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')} title="Settings">
        <SettingsIcon />
      </button>
    </div>
  );
}

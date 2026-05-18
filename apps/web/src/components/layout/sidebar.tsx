'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: '/' },
  { label: 'Financial', href: '/dashboards/financial', icon: 'F' },
  { label: 'Parties', href: '/parties', icon: 'P' },
  { label: 'Lots', href: '/lots', icon: 'L' },
  { label: 'Chambers', href: '/chambers', icon: 'C' },
  { label: 'Rate Plans', href: '/billing/rate-plans', icon: 'R' },
  { label: 'Service Charges', href: '/billing/service-charges', icon: '$' },
  { label: 'Invoices', href: '/invoices', icon: 'I' },
  { label: 'Payments', href: '/payments', icon: '$' },
  { label: 'Quality', href: '/quality', icon: 'Q' },
  { label: 'Gate Pass', href: '/gate', icon: 'G' },
  { label: 'Loans', href: '/loans', icon: 'A' },
  { label: 'Reports', href: '/reports', icon: 'R' },
  { label: 'Accounting', href: '/accounting', icon: 'J' },
  { label: 'Settings', href: '/settings', icon: 'S' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-primary-900 text-white min-h-screen flex flex-col">
      <div className="p-4 border-b border-primary-700">
        <h1 className="text-lg font-bold">ColdChain</h1>
        <p className="text-xs text-primary-300">Cold Storage Management</p>
      </div>

      <nav className="flex-1 py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-primary-700 text-white font-medium'
                  : 'text-primary-200 hover:bg-primary-800 hover:text-white'
              }`}
            >
              <span className="w-6 h-6 rounded bg-primary-700 text-xs flex items-center justify-center mr-3 font-mono">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

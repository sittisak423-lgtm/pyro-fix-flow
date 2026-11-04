import { SessionProvider, useSession } from './state/session';
import { DataProvider, useData } from './state/data';
import { NavProvider, useNav } from './state/nav';
import { LoginPage, SetPasswordPage, NoProfilePage, NoConfigPage } from './pages/Auth';
import { Layout, navFor } from './components/Layout';
import { Loading } from './components/ui';
import ReportPage from './pages/Report';
import MinePage from './pages/Mine';
import ApprovePage from './pages/Approve';
import JobsPage from './pages/Jobs';
import AllRequestsPage from './pages/AllRequests';
import AssetsPage from './pages/Assets';
import PmPage from './pages/PM';
import AdminPage from './pages/admin/Admin';
import DashboardPage from './pages/Dashboard';

function Pages() {
  const { page } = useNav();
  const d = useData();
  if (d.loading) return <Loading />;
  if (d.error) return <div className="card card-pad" style={{ borderLeft: '4px solid var(--danger)' }}>⚠ โหลดข้อมูลไม่สำเร็จ: {d.error} <button className="btn btn-sm" onClick={() => d.reload()}>ลองใหม่</button></div>;
  const nav = navFor(d);
  const view = nav.some(n => n.key === page) ? page : nav[0].key;
  switch (view) {
    case 'report': return <ReportPage />;
    case 'mine': return <MinePage />;
    case 'approve': return <ApprovePage />;
    case 'jobs': return <JobsPage />;
    case 'all': return <AllRequestsPage />;
    case 'assets': return <AssetsPage />;
    case 'pm': return <PmPage />;
    case 'admin': return <AdminPage />;
    case 'dashboard': return <DashboardPage />;
    default: return null;
  }
}

function Gate() {
  const { status } = useSession();
  if (status === 'no-config') return <NoConfigPage />;
  if (status === 'loading') return <Loading text="กำลังเชื่อมต่อ…" />;
  if (status === 'signed-out') return <LoginPage />;
  if (status === 'set-password') return <SetPasswordPage />;
  if (status === 'no-profile') return <NoProfilePage />;
  return (
    <DataProvider>
      <Layout><Pages /></Layout>
    </DataProvider>
  );
}

export default function App() {
  return <SessionProvider><NavProvider><Gate /></NavProvider></SessionProvider>;
}

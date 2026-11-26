import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Landing from '@/pages/Landing';
import ResetPassword from '@/pages/ResetPassword';
import DashboardLayout from '@/pages/dashboard/DashboardLayout';
import Practice from '@/pages/dashboard/Practice';
import Tutor from '@/pages/dashboard/Tutor';
import Progress from '@/pages/dashboard/Progress';
import Community from '@/pages/dashboard/Community';
import Sessions from '@/pages/dashboard/Sessions';
import Leaderboard from '@/pages/dashboard/Leaderboard';
import Meet from '@/pages/dashboard/Meet';
import MeetRoom from '@/pages/dashboard/MeetRoom';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Practice />} />
          <Route path="tutor" element={<Tutor />} />
          <Route path="progress" element={<Progress />} />
          <Route path="community" element={<Community />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="meet" element={<Meet />} />
          <Route path="meet/:roomId" element={<MeetRoom />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

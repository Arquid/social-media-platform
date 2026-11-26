import { lazy, Suspense } from 'react';
import { Link as RouterLink, Routes, Route, useLocation } from 'react-router-dom';
import { Container, Box, CircularProgress, Link } from '@mui/material';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

// Each page is loaded only when the user first visits it
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Home = lazy(() => import('./pages/Home'));
const Profile = lazy(() => import('./pages/Profile'));
const Notifications = lazy(() => import('./pages/Notifications'));
const PostPage = lazy(() => import('./pages/PostPage'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Search = lazy(() => import('./pages/Search'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));
const AdminReports = lazy(() => import('./pages/AdminReports'));

function PageFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
      <CircularProgress aria-label="Loading" />
    </Box>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <>
      <Navbar />
      <Container component="main" maxWidth="sm" sx={{ py: 3 }}>
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
              <Route path="/profile/:username" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/search" element={<ProtectedRoute><Search /></ProtectedRoute>} />
              <Route path="/admin/reports" element={<ProtectedRoute><AdminReports /></ProtectedRoute>} />
              <Route path="/post/:id" element={<ProtectedRoute><PostPage /></ProtectedRoute>} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Container>
      <Box component="footer" sx={{ py: 3, display: 'flex', justifyContent: 'center', gap: 3 }}>
        <Link component={RouterLink} to="/terms" underline="always" variant="body2">Terms of Use</Link>
        <Link component={RouterLink} to="/privacy" underline="always" variant="body2">Privacy Policy</Link>
      </Box>
    </>
  );
}
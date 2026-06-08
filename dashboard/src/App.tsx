import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';
import AuthGuard from './components/AuthGuard';
import AdminGuard from './components/AdminGuard';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import MenuPage from './pages/MenuPage';
import IncomePage from './pages/IncomePage';
import SettingsPage from './pages/SettingsPage';
import RestaurantsPage from './pages/admin/RestaurantsPage';
import RestaurantDetailPage from './pages/admin/RestaurantDetailPage';

function DefaultRedirect() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? '/admin' : '/orders'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
            <Route index element={<DefaultRedirect />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderDetailPage />} />
            <Route path="income" element={<IncomePage />} />
            <Route path="menu" element={<MenuPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminGuard><RestaurantsPage /></AdminGuard>} />
            <Route path="admin/restaurants/:id" element={<AdminGuard><RestaurantDetailPage /></AdminGuard>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

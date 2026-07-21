import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';
import AuthGuard from './components/AuthGuard';
import AdminGuard from './components/AdminGuard';
import Layout from './components/Layout';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import LoginPage from './pages/LoginPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import MenuPage from './pages/MenuPage';
import OptionGroupsPage from './pages/OptionGroupsPage';
import IncomePage from './pages/IncomePage';
import SettingsPage from './pages/SettingsPage';
import CustomersPage from './pages/CustomersPage';
import RestaurantsPage from './pages/admin/RestaurantsPage';
import RestaurantDetailPage from './pages/admin/RestaurantDetailPage';
import AdminRestaurantMapPage from './pages/admin/AdminRestaurantMapPage';
import EarningsPage from './pages/admin/EarningsPage';
import AiConfigPage from './pages/admin/AiConfigPage';
import SelectRestaurantPage from './pages/SelectRestaurantPage';
import LearnedPhrasesPage from './pages/LearnedPhrasesPage';
import IntentPlaygroundPage from './pages/IntentPlaygroundPage';
import IntentDefaultsPage from './pages/IntentDefaultsPage';

const PUBLIC_MAP_ORIGIN = 'https://whatorder.at';

function RedirectPublicMap() {
  useEffect(() => {
    window.location.replace(`${PUBLIC_MAP_ORIGIN}/map${window.location.search}`);
  }, []);
  return null;
}

function DefaultRedirect() {
  const { isAdmin, businessId, businessIds } = useAuth();
  if (!isAdmin && businessIds.length > 1 && !businessId) {
    return <Navigate to="/select-restaurant" replace />;
  }
  return <Navigate to={isAdmin ? '/admin' : '/orders'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ConfirmDialogProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/map" element={<RedirectPublicMap />} />
            <Route path="/select-restaurant" element={<SelectRestaurantPage />} />
            <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
              <Route index element={<DefaultRedirect />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/:orderId" element={<OrderDetailPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="income" element={<IncomePage />} />
              <Route path="menu" element={<MenuPage />} />
              <Route path="option-groups" element={<OptionGroupsPage />} />
              <Route path="learned-phrases" element={<LearnedPhrasesPage />} />
              <Route path="intent-playground" element={<IntentPlaygroundPage />} />
              <Route path="intent-defaults" element={<IntentDefaultsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="admin" element={<AdminGuard><RestaurantsPage /></AdminGuard>} />
              <Route path="admin/map" element={<AdminGuard><AdminRestaurantMapPage /></AdminGuard>} />
              <Route path="admin/restaurants/:id" element={<AdminGuard><RestaurantDetailPage /></AdminGuard>} />
              <Route path="admin/earnings" element={<AdminGuard><EarningsPage /></AdminGuard>} />
              <Route path="admin/ai" element={<AdminGuard><AiConfigPage /></AdminGuard>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmDialogProvider>
    </AuthProvider>
  );
}

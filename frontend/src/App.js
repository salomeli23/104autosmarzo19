import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Appointments } from './pages/Appointments';
import { CheckIn } from './pages/CheckIn';
import { Vehicles } from './pages/Vehicles';
import { Inspections } from './pages/Inspections';
import { Assign } from './pages/Assign';
import { TechnicianView } from './pages/TechnicianView';
import { Billing } from './pages/Billing';
import { Quotes } from './pages/Quotes';
import { ServiceOrders } from './pages/ServiceOrders';
import { Notifications } from './pages/Notifications';
import { Settings } from './pages/Settings';
import CuttingView from './pages/CuttingView';
import './App.css';

const ProtectedRoute = ({ children, allowedRoles }) => {
    const { user, loading, isAuthenticated } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(user?.role)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <Layout>{children}</Layout>;
};

const PublicRoute = ({ children }) => {
    const { isAuthenticated, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (isAuthenticated) {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
};

function AppRoutes() {
    return (
        <Routes>
            <Route 
                path="/login" 
                element={
                    <PublicRoute>
                        <Login />
                    </PublicRoute>
                } 
            />
            <Route 
                path="/dashboard" 
                element={
                    <ProtectedRoute>
                        <Dashboard />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/appointments" 
                element={
                    <ProtectedRoute allowedRoles={['admin', 'asesor']}>
                        <Appointments />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/checkin" 
                element={
                    <ProtectedRoute allowedRoles={['admin', 'asesor']}>
                        <CheckIn />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/vehicles" 
                element={
                    <ProtectedRoute>
                        <Vehicles />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/inspections" 
                element={
                    <ProtectedRoute>
                        <Inspections />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/assign" 
                element={
                    <ProtectedRoute allowedRoles={['admin', 'coordinador']}>
                        <Assign />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/cutting" 
                element={
                    <ProtectedRoute allowedRoles={['admin', 'corte', 'coordinador']}>
                        <CuttingView />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/technician" 
                element={
                    <ProtectedRoute allowedRoles={['admin', 'tecnico']}>
                        <TechnicianView />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/billing" 
                element={
                    <ProtectedRoute allowedRoles={['admin', 'facturacion']}>
                        <Billing />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/quotes" 
                element={
                    <ProtectedRoute allowedRoles={['admin', 'asesor']}>
                        <Quotes />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/service-orders" 
                element={
                    <ProtectedRoute>
                        <ServiceOrders />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/notifications" 
                element={
                    <ProtectedRoute>
                        <Notifications />
                    </ProtectedRoute>
                } 
            />
            <Route 
                path="/settings" 
                element={
                    <ProtectedRoute allowedRoles={['admin']}>
                        <Settings />
                    </ProtectedRoute>
                } 
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
    );
}

function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <AppRoutes />
                    <Toaster position="top-right" richColors />
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    );
}

export default App;

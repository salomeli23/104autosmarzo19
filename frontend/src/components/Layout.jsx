import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { alertsAPI } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
    LayoutDashboard,
    Calendar,
    Car,
    ClipboardCheck,
    FileText,
    Wrench,
    Bell,
    Settings,
    LogOut,
    Menu,
    Sun,
    Moon,
    User,
    ChevronRight,
    UserPlus,
    QrCode,
    CreditCard,
    Scissors,
    Boxes,
    ShieldCheck,
    Warehouse,
    Receipt,
    LogOut as LogOutIcon,
    FileSignature,
    PackageCheck,
} from 'lucide-react';

const LOGO_URL = "https://customer-assets-v7afamib.emergentagent.net/job_b82a71c1-21ff-43aa-b9e3-58e664ba5004/artifacts/bi9tgemi_Recurso%203%402x.png";

const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'asesor', 'coordinador', 'tecnico', 'facturacion', 'corte', 'accesorios'] },
    { path: '/appointments', label: 'Agendamiento', icon: Calendar, roles: ['admin', 'asesor'] },
    { path: '/checkin', label: 'Check-in / Ingreso', icon: QrCode, roles: ['admin', 'asesor'] },
    { path: '/vehicles', label: 'Vehículos', icon: Car, roles: ['admin', 'asesor', 'coordinador'] },
    { path: '/auto-asignar', label: 'Autos por Asignar', icon: UserPlus, roles: ['admin', 'coordinador'] },
    { path: '/cutting', label: 'Corte de Piezas', icon: Scissors, roles: ['admin', 'corte', 'coordinador'] },
    { path: '/technician', label: 'Mis Servicios', icon: Wrench, roles: ['admin', 'tecnico'] },
    { path: '/billing', label: 'Facturación', icon: CreditCard, roles: ['admin', 'facturacion'] },
    { path: '/pagos', label: 'Pagos', icon: Receipt, roles: ['admin', 'asesor', 'facturacion', 'coordinador'] },
    { path: '/facturacion-electronica', label: 'Clientes por Facturar', icon: FileSignature, roles: ['admin', 'facturacion', 'asesor'] },
    { path: '/autos-salida', label: 'Autorizar Salida', icon: LogOutIcon, roles: ['admin', 'facturacion', 'coordinador'] },
    { path: '/quotes', label: 'Cotizaciones', icon: FileText, roles: ['admin', 'asesor'] },
    { path: '/service-orders', label: 'Órdenes', icon: Wrench, roles: ['admin', 'asesor', 'coordinador', 'facturacion'] },
    { path: '/postventa', label: 'Postventa / Garantías', icon: ShieldCheck, roles: ['admin', 'asesor', 'coordinador'] },
    { path: '/accesorios', label: 'Accesorios', icon: PackageCheck, roles: ['admin', 'accesorios', 'coordinador'] },
    { path: '/inventory', label: 'Inventario', icon: Boxes, roles: ['admin', 'coordinador', 'corte'] },
    { path: '/settings', label: 'Configuración', icon: Settings, roles: ['admin'] },
];

export const Layout = ({ children }) => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const location = useLocation();
    const navigate = useNavigate();
    const [unreadCount, setUnreadCount] = useState(0);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const fetchUnreadCount = async () => {
            try {
                const response = await alertsAPI.getUnreadCount();
                setUnreadCount(response.data.count);
            } catch (error) {
                console.error('Error fetching notifications:', error);
            }
        };

        if (user) {
            fetchUnreadCount();
            const interval = setInterval(fetchUnreadCount, 30000);
            return () => clearInterval(interval);
        }
    }, [user]);

    const filteredNavItems = navItems.filter(item => 
        item.roles.includes(user?.role)
    );

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const NavLink = ({ item, mobile = false }) => {
        const isActive = location.pathname === item.path;
        const Icon = item.icon;
        
        return (
            <Link
                to={item.path}
                onClick={() => mobile && setMobileOpen(false)}
                className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg transition-all touch-target",
                    isActive 
                        ? "bg-primary text-primary-foreground font-semibold" 
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                data-testid={`nav-${item.path.slice(1)}`}
            >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
                {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
            </Link>
        );
    };

    return (
        <div className="min-h-screen bg-background noise-texture">
            {/* Desktop Sidebar */}
            <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-border bg-card">
                <div className="flex flex-col flex-1 min-h-0 pt-5 pb-4">
                    {/* Logo */}
                    <div className="flex items-center justify-center px-4 mb-6">
                        <img 
                            src={LOGO_URL} 
                            alt="Polarizados Manager" 
                            className="h-16 w-auto object-contain"
                        />
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
                        {filteredNavItems.map(item => (
                            <NavLink key={item.path} item={item} />
                        ))}
                    </nav>

                    {/* User section */}
                    <div className="px-3 mt-auto">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                                <User className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{user?.name}</p>
                                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <div className="md:pl-64">
                {/* Top header */}
                <header className="sticky top-0 z-40 glass-header">
                    <div className="flex items-center justify-between h-16 px-4 md:px-8">
                        {/* Mobile menu */}
                        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                            <SheetTrigger asChild className="md:hidden">
                                <Button variant="ghost" size="icon" data-testid="mobile-menu-btn">
                                    <Menu className="w-5 h-5" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-72 p-0">
                                <div className="flex flex-col h-full pt-6">
                                    <div className="flex items-center justify-center px-4 mb-6">
                                        <img 
                                            src={LOGO_URL} 
                                            alt="Polarizados Manager" 
                                            className="h-14 w-auto object-contain"
                                        />
                                    </div>
                                    <nav className="flex-1 px-3 space-y-1">
                                        {filteredNavItems.map(item => (
                                            <NavLink key={item.path} item={item} mobile />
                                        ))}
                                    </nav>
                                </div>
                            </SheetContent>
                        </Sheet>

                        {/* Mobile logo */}
                        <img 
                            src={LOGO_URL} 
                            alt="Polarizados Manager" 
                            className="h-10 w-auto object-contain md:hidden"
                        />

                        <div className="hidden md:block" />

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            {/* Theme toggle */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={toggleTheme}
                                data-testid="theme-toggle-btn"
                            >
                                {theme === 'dark' ? (
                                    <Sun className="w-5 h-5" />
                                ) : (
                                    <Moon className="w-5 h-5" />
                                )}
                            </Button>

                            {/* Notifications */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="relative"
                                onClick={() => navigate('/notifications')}
                                data-testid="notifications-btn"
                            >
                                <Bell className="w-5 h-5" />
                                {unreadCount > 0 && (
                                    <Badge 
                                        className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-destructive"
                                    >
                                        {unreadCount}
                                    </Badge>
                                )}
                            </Button>

                            {/* User menu */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" data-testid="user-menu-btn">
                                        <User className="w-5 h-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                    <div className="px-2 py-1.5">
                                        <p className="text-sm font-medium">{user?.name}</p>
                                        <p className="text-xs text-muted-foreground">{user?.email}</p>
                                    </div>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={handleLogout} data-testid="logout-btn">
                                        <LogOut className="w-4 h-4 mr-2" />
                                        Cerrar Sesión
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <main className="p-4 md:p-8 animate-fade-in">
                    {children}
                </main>
            </div>

            {/* Mobile bottom navigation */}
            <nav className="mobile-nav">
                <div className="flex justify-around items-center h-16">
                    {filteredNavItems.slice(0, 5).map(item => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-colors touch-target",
                                    isActive ? "text-primary" : "text-muted-foreground"
                                )}
                                data-testid={`mobile-nav-${item.path.slice(1)}`}
                            >
                                <Icon className="w-5 h-5" />
                                <span className="text-[10px] font-medium">{item.label.split(' ')[0]}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
};

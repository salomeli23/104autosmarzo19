import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { usersAPI, settingsAPI, authAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ROLE_LABELS } from '../lib/utils';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Users, Shield, User, KeyRound, Eye, EyeOff, UserPlus } from 'lucide-react';
import { DiscountCodesSection } from '../components/DiscountCodesSection';
import { SedesSection, CarSeriesSection, ServiceExtrasSection, ServiceRoutesSection, TechnicianRolesSection } from '../components/SettingsSections';

export const Settings = () => {
    const { user } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    // Booking PIN
    const [bookingPin, setBookingPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [pinLoading, setPinLoading] = useState(false);
    const [pinSaving, setPinSaving] = useState(false);

    // Completion PIN
    const [completionPin, setCompletionPin] = useState('');
    const [newCompletionPin, setNewCompletionPin] = useState('');
    const [confirmCompletionPin, setConfirmCompletionPin] = useState('');
    const [showCompletionPin, setShowCompletionPin] = useState(false);
    const [completionPinLoading, setCompletionPinLoading] = useState(false);
    const [completionPinSaving, setCompletionPinSaving] = useState(false);

    // Crear usuario
    const emptyNewUser = { name: '', email: '', phone: '', role: 'accesorios', password: '' };
    const [newUser, setNewUser] = useState(emptyNewUser);
    const [creatingUser, setCreatingUser] = useState(false);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const response = await usersAPI.getAll();
                setUsers(response.data);
            } catch (error) {
                console.error('Error fetching users:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchUsers();
    }, []);

    useEffect(() => {
        const fetchPin = async () => {
            try {
                setPinLoading(true);
                const res = await settingsAPI.getBookingPin();
                setBookingPin(res.data?.pin || '');
            } catch (error) {
                console.error('Error fetching PIN:', error);
            } finally {
                setPinLoading(false);
            }
        };
        fetchPin();
    }, []);

    useEffect(() => {
        const fetchCompletionPin = async () => {
            try {
                setCompletionPinLoading(true);
                const res = await settingsAPI.getCompletionPin();
                setCompletionPin(res.data?.pin || '');
            } catch (error) {
                console.error('Error fetching completion PIN:', error);
            } finally {
                setCompletionPinLoading(false);
            }
        };
        fetchCompletionPin();
    }, []);

    const handleSaveCompletionPin = async () => {
        if (!newCompletionPin || newCompletionPin.length < 4) {
            toast.error('El PIN debe tener al menos 4 dígitos');
            return;
        }
        if (newCompletionPin !== confirmCompletionPin) {
            toast.error('Los PINs no coinciden');
            return;
        }
        try {
            setCompletionPinSaving(true);
            const res = await settingsAPI.updateCompletionPin(newCompletionPin);
            setCompletionPin(res.data?.pin || newCompletionPin);
            setNewCompletionPin('');
            setConfirmCompletionPin('');
            toast.success('PIN actualizado correctamente');
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al actualizar PIN');
        } finally {
            setCompletionPinSaving(false);
        }
    };

    const handleSavePin = async () => {
        if (!newPin || newPin.length < 4) {
            toast.error('El PIN debe tener al menos 4 dígitos');
            return;
        }
        if (newPin !== confirmPin) {
            toast.error('Los PINs no coinciden');
            return;
        }
        try {
            setPinSaving(true);
            const res = await settingsAPI.updateBookingPin(newPin);
            setBookingPin(res.data?.pin || newPin);
            setNewPin('');
            setConfirmPin('');
            toast.success('PIN actualizado correctamente');
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al actualizar PIN');
        } finally {
            setPinSaving(false);
        }
    };

    const handleRoleChange = async (userId, newRole) => {
        try {
            await usersAPI.updateRole(userId, newRole);
            setUsers(prev =>
                prev.map(u => u.id === userId ? { ...u, role: newRole } : u)
            );
            toast.success('Rol actualizado correctamente');
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al actualizar rol');
        }
    };

    const handleCreateUser = async () => {
        if (!newUser.name.trim() || !newUser.email.trim()) {
            toast.error('Escribe el nombre y el correo');
            return;
        }
        if (newUser.password.length < 6) {
            toast.error('La contraseña debe tener al menos 6 caracteres');
            return;
        }
        try {
            setCreatingUser(true);
            const res = await authAPI.register({
                name: newUser.name.trim(),
                email: newUser.email.trim().toLowerCase(),
                phone: newUser.phone.trim() || null,
                role: newUser.role,
                password: newUser.password,
            });
            setUsers(prev => [...prev, res.data.user]);
            setNewUser(emptyNewUser);
            toast.success(`Usuario ${res.data.user.name} creado como ${ROLE_LABELS[res.data.user.role] || res.data.user.role}`);
        } catch (error) {
            const detail = error.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : 'No se pudo crear el usuario. Revisa que el correo sea válido.');
        } finally {
            setCreatingUser(false);
        }
    };

    const getRoleColor = (role) => {
        switch (role) {
            case 'admin': return 'text-red-500 bg-red-500/10';
            case 'asesor': return 'text-blue-500 bg-blue-500/10';
            case 'tecnico': return 'text-green-500 bg-green-500/10';
            case 'accesorios': return 'text-amber-500 bg-amber-500/10';
            default: return 'text-gray-500 bg-gray-500/10';
        }
    };

    return (
        <div className="space-y-6" data-testid="settings-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Configuración</h1>
                <p className="text-muted-foreground">
                    Administra usuarios y configuraciones del sistema
                </p>
            </div>

            {/* Booking PIN Configuration */}
            <Card className="card-hover border-amber-500/30">
                <CardHeader>
                    <CardTitle className="font-heading text-xl flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-amber-400" />
                        PIN de Confirmación de Citas
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                        El PIN es solicitado al agendar una nueva cita para prevenir duplicados.
                        Compártelo solo con asesores autorizados.
                    </p>

                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                            <div className="flex-1">
                                <p className="text-xs text-muted-foreground mb-1">PIN actual</p>
                                <p className="font-mono text-2xl font-bold tracking-widest text-amber-400" data-testid="current-pin-display">
                                    {pinLoading ? '••••' : (showPin ? bookingPin : '•'.repeat(bookingPin.length || 5))}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowPin(prev => !prev)}
                                data-testid="toggle-pin-visibility"
                            >
                                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="new-pin">Nuevo PIN (4-10 dígitos)</Label>
                                <Input
                                    id="new-pin"
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={10}
                                    value={newPin}
                                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Nuevo PIN"
                                    data-testid="new-pin-input"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-pin">Confirmar PIN</Label>
                                <Input
                                    id="confirm-pin"
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={10}
                                    value={confirmPin}
                                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Repite el PIN"
                                    data-testid="confirm-pin-input"
                                />
                            </div>
                        </div>

                        <Button
                            onClick={handleSavePin}
                            disabled={pinSaving || !newPin || newPin !== confirmPin}
                            className="w-full sm:w-auto"
                            data-testid="save-pin-btn"
                        >
                            <KeyRound className="w-4 h-4 mr-2" />
                            {pinSaving ? 'Guardando...' : 'Actualizar PIN'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Completion PIN Configuration */}
            <Card className="card-hover border-green-500/30">
                <CardHeader>
                    <CardTitle className="font-heading text-xl flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-green-400" />
                        PIN de Completar Servicio
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                        Solicitado al coordinador al marcar un servicio como completado al liberar la bahía.
                    </p>

                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                            <div className="flex-1">
                                <p className="text-xs text-muted-foreground mb-1">PIN actual</p>
                                <p className="font-mono text-2xl font-bold tracking-widest text-green-400" data-testid="current-completion-pin-display">
                                    {completionPinLoading ? '••••' : (showCompletionPin ? completionPin : '•'.repeat(completionPin.length || 5))}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowCompletionPin(prev => !prev)}
                                data-testid="toggle-completion-pin-visibility"
                            >
                                {showCompletionPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="new-completion-pin">Nuevo PIN (4-10 dígitos)</Label>
                                <Input
                                    id="new-completion-pin"
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={10}
                                    value={newCompletionPin}
                                    onChange={(e) => setNewCompletionPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Nuevo PIN"
                                    data-testid="new-completion-pin-input"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-completion-pin">Confirmar PIN</Label>
                                <Input
                                    id="confirm-completion-pin"
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={10}
                                    value={confirmCompletionPin}
                                    onChange={(e) => setConfirmCompletionPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Repite el PIN"
                                    data-testid="confirm-completion-pin-input"
                                />
                            </div>
                        </div>

                        <Button
                            onClick={handleSaveCompletionPin}
                            disabled={completionPinSaving || !newCompletionPin || newCompletionPin !== confirmCompletionPin}
                            className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
                            data-testid="save-completion-pin-btn"
                        >
                            <KeyRound className="w-4 h-4 mr-2" />
                            {completionPinSaving ? 'Guardando...' : 'Actualizar PIN'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <DiscountCodesSection />

            {/* Crear usuario */}
            <Card className="card-hover" data-testid="create-user-card">
                <CardHeader>
                    <CardTitle className="font-heading text-xl flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-primary" />
                        Crear usuario
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        El rol <b>Accesorios</b> recibe las solicitudes de accesorios de cada orden, las despacha del inventario y las entrega al técnico instalador.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="new-user-name">Nombre *</Label>
                            <Input id="new-user-name" value={newUser.name} onChange={(e) => setNewUser(u => ({ ...u, name: e.target.value }))} data-testid="new-user-name" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="new-user-email">Correo *</Label>
                            <Input id="new-user-email" type="email" value={newUser.email} onChange={(e) => setNewUser(u => ({ ...u, email: e.target.value }))} data-testid="new-user-email" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="new-user-phone">Teléfono</Label>
                            <Input id="new-user-phone" value={newUser.phone} onChange={(e) => setNewUser(u => ({ ...u, phone: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Rol *</Label>
                            <Select value={newUser.role} onValueChange={(value) => setNewUser(u => ({ ...u, role: value }))}>
                                <SelectTrigger data-testid="new-user-role"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                            <Label htmlFor="new-user-password">Contraseña * (mínimo 6 caracteres)</Label>
                            <Input id="new-user-password" type="password" autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser(u => ({ ...u, password: e.target.value }))} data-testid="new-user-password" />
                        </div>
                    </div>
                    <Button onClick={handleCreateUser} disabled={creatingUser} className="w-full sm:w-auto" data-testid="create-user-btn">
                        <UserPlus className="w-4 h-4 mr-2" />
                        {creatingUser ? 'Creando...' : 'Crear usuario'}
                    </Button>
                </CardContent>
            </Card>

            {/* User Management */}
            <Card className="card-hover">
                <CardHeader>
                    <CardTitle className="font-heading text-xl flex items-center gap-2">
                        <Users className="w-5 h-5 text-primary" />
                        Gestión de Usuarios
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {users.map((u) => (
                                <div 
                                    key={u.id}
                                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50"
                                    data-testid={`user-row-${u.id}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getRoleColor(u.role)}`}>
                                            <User className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{u.name}</p>
                                            <p className="text-sm text-muted-foreground">{u.email}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {u.id === user?.id ? (
                                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getRoleColor(u.role)}`}>
                                                {ROLE_LABELS[u.role]}
                                            </span>
                                        ) : (
                                            <Select
                                                value={u.role}
                                                onValueChange={(value) => handleRoleChange(u.id, value)}
                                            >
                                                <SelectTrigger className="w-40" data-testid={`role-select-${u.id}`}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                                                        <SelectItem key={value} value={value}>{label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* System Info */}
            <Card className="card-hover">
                <CardHeader>
                    <CardTitle className="font-heading text-xl flex items-center gap-2">
                        <SettingsIcon className="w-5 h-5 text-primary" />
                        Información del Sistema
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Versión</p>
                            <p className="font-mono font-medium">1.0.0</p>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Total Usuarios</p>
                            <p className="font-heading text-2xl">{users.length}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <SedesSection />
            <CarSeriesSection />
            <ServiceExtrasSection />
            <ServiceRoutesSection />
            <TechnicianRolesSection />
        </div>
    );
};

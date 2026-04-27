import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';
import { Sun, Moon, Eye, EyeOff } from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_techgarage-app/artifacts/8kw8x7h6_Captura%20de%20Pantalla%202026-01-30%20a%20la%28s%29%2011.36.02%20a.%C2%A0m..png";
const BG_IMAGE = "https://images.unsplash.com/photo-1647649641463-724358c4387e?w=1920&q=80";

export const Login = () => {
    const navigate = useNavigate();
    const { login } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [loginData, setLoginData] = useState({ email: '', password: '' });

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await login(loginData.email, loginData.password);
            toast.success('¡Bienvenido!');
            navigate('/dashboard');
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al iniciar sesión');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex">
            {/* Background image section */}
            <div 
                className="hidden lg:flex lg:w-1/2 bg-cover bg-center relative"
                style={{ backgroundImage: `url(${BG_IMAGE})` }}
            >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className="relative z-10 flex flex-col justify-center items-center w-full p-12">
                    <img 
                        src={LOGO_URL} 
                        alt="Polarizados Manager" 
                        className="h-32 w-auto mb-8"
                    />
                    <h1 className="font-heading text-4xl md:text-5xl text-white text-center mb-4">
                        Manager Software
                    </h1>
                    <p className="text-white/80 text-center text-lg max-w-md">
                        Polarizado • Nanocerámica • Autobahn Black CE • Ultrasecure
                    </p>
                </div>
            </div>

            {/* Form section */}
            <div className="flex-1 flex flex-col justify-center items-center p-4 md:p-8 bg-background">
                {/* Theme toggle */}
                <div className="absolute top-4 right-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleTheme}
                        data-testid="login-theme-toggle"
                    >
                        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </Button>
                </div>

                {/* Mobile logo */}
                <img 
                    src={LOGO_URL} 
                    alt="Polarizados Manager" 
                    className="h-20 w-auto mb-6 lg:hidden"
                />

                <Card className="w-full max-w-md card-hover">
                    <CardHeader className="text-center">
                        <CardTitle className="font-heading text-2xl">Bienvenido</CardTitle>
                        <CardDescription>
                            Ingresa a tu cuenta para continuar
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="login-email">Correo Electrónico</Label>
                                <Input
                                    id="login-email"
                                    type="email"
                                    placeholder="correo@ejemplo.com"
                                    value={loginData.email}
                                    onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                                    required
                                    data-testid="login-email-input"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="login-password">Contraseña</Label>
                                <div className="relative">
                                    <Input
                                        id="login-password"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="••••••••"
                                        value={loginData.password}
                                        onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                                        required
                                        data-testid="login-password-input"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-0 top-0 h-full px-3"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </Button>
                                </div>
                            </div>
                            <Button 
                                type="submit" 
                                className="w-full brand-glow" 
                                disabled={loading}
                                data-testid="login-submit-btn"
                            >
                                {loading ? 'Ingresando...' : 'Ingresar'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

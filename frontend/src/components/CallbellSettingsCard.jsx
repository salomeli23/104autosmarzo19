import React, { useEffect, useState } from 'react';
import { callbellAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { Bot, Copy, CheckCircle2, XCircle, ListChecks, RefreshCw, Loader2, UserPlus, Link2 } from 'lucide-react';

const WEBHOOK_BASE = process.env.REACT_APP_BACKEND_URL || '';

const Flag = ({ ok, label }) => (
    <p className={`text-sm flex items-center gap-1.5 ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
        {ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {label}
    </p>
);

/** Un asesor de Callbell: si ya tiene cuenta de asesor en la app, o crearla / vincularla */
const AgentRow = ({ a, advisors, onDone }) => {
    const [mode, setMode] = useState('');
    const [name, setName] = useState(a.name);
    const [password, setPassword] = useState('');
    const [userId, setUserId] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        setBusy(true);
        try {
            const { data } = await callbellAPI.agentAccount(mode === 'link' ? { email: a.email, name, user_id: userId } : { email: a.email, name, password });
            toast.success(data.message);
            setMode(''); setPassword('');
            onDone();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className={`rounded-md border p-2.5 space-y-2 ${a.ok ? '' : 'border-amber-500/40 bg-amber-500/5'}`} data-testid={`callbell-agent-row-${a.email}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground break-all">{a.email} · {a.leads} lead(s){a.pendientes ? ` · ${a.pendientes} por ingresar` : ''}</p>
                </div>
                {a.ok ? (
                    <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Cuenta: {a.user?.name}</span>
                ) : (
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-amber-400">Falta la cuenta</span>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setMode(mode === 'create' ? '' : 'create')} data-testid={`agent-create-${a.email}`}>
                            <UserPlus className="w-3.5 h-3.5 mr-1" /> Crear
                        </Button>
                        {advisors.length > 0 && (
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => setMode(mode === 'link' ? '' : 'link')}>
                                <Link2 className="w-3.5 h-3.5 mr-1" /> Vincular
                            </Button>
                        )}
                    </div>
                )}
            </div>
            {mode === 'create' && (
                <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <div className="space-y-1"><Label className="text-xs">Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Contraseña inicial</Label>
                        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-8 text-sm" placeholder="Mínimo 6 caracteres" /></div>
                    <Button size="sm" onClick={submit} disabled={busy || password.length < 6 || name.trim().length < 3}>{busy ? 'Creando...' : 'Crear asesor'}</Button>
                    <p className="text-[11px] text-muted-foreground sm:col-span-3">Entra con el correo {a.email}. Sus leads de Callbell pasan a su sesión.</p>
                </div>
            )}
            {mode === 'link' && (
                <div className="flex flex-wrap gap-2 items-center">
                    <select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
                        <option value="">Elige la cuenta de asesor…</option>
                        {advisors.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                    </select>
                    <Button size="sm" onClick={submit} disabled={busy || !userId}>{busy ? 'Guardando...' : 'Vincular'}</Button>
                </div>
            )}
        </div>
    );
};

/** Configuración: conexión con Callbell (leads del bot con cita → Agendamiento) */
export const CallbellSettingsCard = () => {
    const [st, setSt] = useState(null);
    const [tag, setTag] = useState('');
    const [teamUuid, setTeamUuid] = useState('');
    const [teams, setTeams] = useState(null);
    const [fields, setFields] = useState({});
    const [found, setFound] = useState(null);
    const [advisors, setAdvisors] = useState([]);
    const [advEmails, setAdvEmails] = useState({});
    const [busy, setBusy] = useState('');
    const [agents, setAgents] = useState(null);

    const load = () => callbellAPI.status().then(res => {
        setSt(res.data);
        setTag(res.data.tag);
        setTeamUuid(res.data.team_uuid || '');
        if (res.data.team_uuid) setTeams(prev => prev || [{ uuid: res.data.team_uuid, name: res.data.team_name || res.data.team_uuid }]);
        setFields(res.data.fields);
    }).catch(() => setSt(null));
    const loadAdvisors = () => callbellAPI.advisors().then(res => {
        setAdvisors(res.data || []);
        setAdvEmails(Object.fromEntries((res.data || []).map(a => [a.id, a.callbell_email || ''])));
    }).catch(() => setAdvisors([]));
    const loadAgents = () => callbellAPI.agents().then(res => setAgents(res.data || [])).catch(() => setAgents([]));
    useEffect(() => { load(); loadAdvisors(); loadAgents(); }, []);

    if (!st) return null;
    const webhookUrl = `${WEBHOOK_BASE}${st.webhook_path}`;

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo completar'); } finally { setBusy(''); }
    };
    const save = () => run('save', async () => {
        await callbellAPI.saveConfig({ tag, fields, team_uuid: teamUuid, team_name: (teams || []).find(t => t.uuid === teamUuid)?.name || '' });
        toast.success('Configuración de Callbell guardada');
        load();
    });
    const saveAdvisors = () => run('advisors', async () => {
        await callbellAPI.saveAdvisors(advEmails);
        toast.success('Asesores vinculados con Callbell');
        loadAdvisors();
        loadAgents();
    });
    const findFields = () => run('fields', async () => {
        const { data } = await callbellAPI.fields();
        setFound(data);
    });
    const loadTeams = () => run('teams', async () => {
        const { data } = await callbellAPI.teams();
        setTeams(data || []);
        if (!(data || []).length) toast.message('Callbell no devolvió equipos');
    });
    const sync = () => run('sync', async () => {
        const { data } = await callbellAPI.sync(true);
        toast.success(data.message || 'Sincronizando con Callbell');
        [20000, 60000].forEach(ms => setTimeout(load, ms));
    });

    return (
        <Card className="card-hover" data-testid="callbell-settings">
            <CardHeader>
                <CardTitle className="font-heading text-xl flex items-center gap-2"><Bot className="w-5 h-5 text-emerald-400" /> Callbell (bot y CRM)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Los contactos del equipo elegido que tengan en el chat el formulario de agendamiento diligenciado (Nombre completo, Vehículo,
                    Placa, Celular, Correo, Servicio, Valor pactado, Método de pago) llegan a Agendamiento → "Clientes Bot" como leads por ingresar.
                    Se revisan los clientes que escribieron en los últimos 30 días.
                    El asesor o el coordinador los agenda con un clic. Se revisa al instante (webhook) y cada {st.poll_minutes} min.
                </p>

                <div className="space-y-1">
                    <Flag ok={st.token_configured} label={st.token_configured ? 'Token de la API configurado' : 'Falta la variable CALLBELL_API_TOKEN en Railway (servicio backend)'} />
                    <Flag ok={st.secret_configured} label={st.secret_configured ? 'Firma del webhook activa' : 'Opcional: CALLBELL_WEBHOOK_SECRET (el secreto whsec_… del webhook)'} />
                    {st.last_sync_error && <p className="text-xs text-red-400">Último error: {st.last_sync_error}</p>}
                    {st.last_sync_at && (
                        <p className="text-xs text-muted-foreground">
                            Última revisión {formatDateTime(st.last_sync_at)}
                            {st.last_sync_result ? ` · ${st.last_sync_result.revisados} contacto(s) revisado(s), ${st.last_sync_result.pendientes} lead(s) por agendar` : ''}
                            {` · Total: ${st.leads.agendado} agendado(s), ${st.leads.pendiente} pendiente(s)`}
                        </p>
                    )}
                </div>

                <div className="space-y-1">
                    <Label>URL del webhook (pégala en Callbell → Configuración → API → Webhooks)</Label>
                    <div className="flex gap-2">
                        <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                        <Button variant="outline" size="icon" onClick={() => { navigator.clipboard?.writeText(webhookUrl); toast.success('URL copiada'); }} aria-label="Copiar URL">
                            <Copy className="w-4 h-4" />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Eventos: {st.events.join(', ')}.</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <Label>Equipo de Callbell (de aquí salen los leads)</Label>
                        <div className="flex gap-2">
                            <select value={teamUuid} onChange={(e) => setTeamUuid(e.target.value)} data-testid="callbell-team"
                                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
                                <option value="">Sin equipo (solo por etiqueta)</option>
                                {(teams || []).map(t => <option key={t.uuid} value={t.uuid}>{t.name}</option>)}
                            </select>
                            <Button variant="outline" size="sm" onClick={loadTeams} disabled={!st.token_configured || busy === 'teams'} title="Traer equipos de Callbell">
                                {busy === 'teams' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                            </Button>
                        </div>
                        {st.team_error && <p className="text-xs text-red-400">{st.team_error}</p>}
                    </div>
                    <div className="space-y-1">
                        <Label>Etiqueta (opcional)</Label>
                        <Input value={tag} onChange={(e) => setTag(e.target.value)} data-testid="callbell-tag" />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <Label>Nombre de cada campo personalizado en Callbell</Label>
                        <Button variant="ghost" size="sm" onClick={findFields} disabled={!st.token_configured || busy === 'fields'}>
                            {busy === 'fields' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ListChecks className="w-4 h-4 mr-1" />} Ver campos de Callbell
                        </Button>
                    </div>
                    {found && (
                        <p className="text-xs text-muted-foreground rounded-md border p-2">
                            {found.contacts} lead(s) con la etiqueta. Campos: {found.fields.length ? found.fields.map(f => `${f.name} (${f.count})`).join(' · ') : 'ninguno con datos'}
                        </p>
                    )}
                    <div className="grid sm:grid-cols-2 gap-2">
                        {Object.entries(st.field_labels).map(([k, label]) => (
                            <div key={k} className="space-y-1">
                                <span className="text-xs text-muted-foreground">{label}</span>
                                <Input value={fields[k] || ''} onChange={(e) => setFields(prev => ({ ...prev, [k]: e.target.value }))} className="h-8 text-sm" />
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Si el nombre no coincide exacto, se busca un campo que lo contenga (por ejemplo "fecha", "hora", "placa").</p>
                </div>

                <div className="space-y-2" data-testid="callbell-agents">
                    <div className="flex items-center justify-between gap-2">
                        <Label>Asesores de Callbell y su cuenta en la app</Label>
                        <Button size="sm" variant="ghost" className="h-7" onClick={loadAgents}><RefreshCw className="w-3.5 h-3.5" /></Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        El administrador ve todos los leads; cada asesor ve solo los que tiene asignados en Callbell.
                        {agents && agents.some(a => !a.ok) && <b className="text-amber-400"> Faltan {agents.filter(a => !a.ok).length} cuenta(s) de asesor: sus leads solo los ve el administrador.</b>}
                    </p>
                    {agents === null ? <p className="text-xs text-muted-foreground">Cargando…</p>
                        : agents.length === 0 ? <p className="text-xs text-muted-foreground">Aún no hay asesores de Callbell: aparecen después de sincronizar.</p>
                        : agents.map(a => <AgentRow key={a.email} a={a} advisors={advisors} onDone={() => { loadAgents(); loadAdvisors(); }} />)}
                </div>

                <div className="space-y-2" data-testid="callbell-advisors">
                    <Label>Asesores: correo con el que cada uno está en Callbell</Label>
                    <p className="text-xs text-muted-foreground">
                        Cada lead llega con el asesor que lo tiene asignado en Callbell, y la cita queda a su nombre y en su sesión.
                        Si el asesor usa en Callbell el mismo correo de la app, déjalo vacío.
                    </p>
                    {advisors.length === 0 ? <p className="text-xs text-muted-foreground">No hay asesores activos.</p> : advisors.map(a => (
                        <div key={a.id} className="grid sm:grid-cols-[1fr_1.4fr] gap-2 items-center">
                            <div className="text-sm min-w-0">
                                <p className="font-medium truncate">{a.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{a.email} · {a.leads} lead(s)</p>
                            </div>
                            <Input type="email" value={advEmails[a.id] || ''} placeholder={`Igual que la app (${a.email})`}
                                onChange={(e) => setAdvEmails(prev => ({ ...prev, [a.id]: e.target.value }))} className="h-8 text-sm" />
                        </div>
                    ))}
                    {advisors.length > 0 && (
                        <Button size="sm" variant="outline" onClick={saveAdvisors} disabled={busy === 'advisors'}>
                            {busy === 'advisors' ? 'Guardando...' : 'Guardar asesores'}
                        </Button>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Guardando...' : 'Guardar'}</Button>
                    <Button variant="outline" onClick={sync} disabled={!st.token_configured || busy === 'sync'}>
                        {busy === 'sync' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />} Sincronizar ahora
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

export default CallbellSettingsCard;

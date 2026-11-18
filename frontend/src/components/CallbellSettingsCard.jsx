import React, { useEffect, useState } from 'react';
import { callbellAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { Bot, Copy, CheckCircle2, XCircle, ListChecks, RefreshCw, Loader2 } from 'lucide-react';

const WEBHOOK_BASE = process.env.REACT_APP_BACKEND_URL || '';

const Flag = ({ ok, label }) => (
    <p className={`text-sm flex items-center gap-1.5 ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
        {ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {label}
    </p>
);

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
    useEffect(() => { load(); loadAdvisors(); }, []);

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
        const { data } = await callbellAPI.sync();
        toast.success(`${data.leads} lead(s) por agendar · ${data.revisados} revisado(s)`);
        load();
    });

    return (
        <Card className="card-hover" data-testid="callbell-settings">
            <CardHeader>
                <CardTitle className="font-heading text-xl flex items-center gap-2"><Bot className="w-5 h-5 text-emerald-400" /> Callbell (bot y CRM)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Los contactos del equipo elegido con la etiqueta llegan a Agendamiento → "Leads de Callbell" como leads por ingresar,
                    con los datos que el cliente escribió en el chat (nombre, placa, celular, correo, servicio, valor y forma de pago).
                    El asesor o el coordinador los agenda con un clic. Se revisa al instante (webhook) y cada {st.poll_minutes} min.
                </p>

                <div className="space-y-1">
                    <Flag ok={st.token_configured} label={st.token_configured ? 'Token de la API configurado' : 'Falta la variable CALLBELL_API_TOKEN en Railway (servicio backend)'} />
                    <Flag ok={st.secret_configured} label={st.secret_configured ? 'Firma del webhook activa' : 'Opcional: CALLBELL_WEBHOOK_SECRET (el secreto whsec_… del webhook)'} />
                    {st.last_sync_at && (
                        <p className="text-xs text-muted-foreground">
                            Última revisión {formatDateTime(st.last_sync_at)}
                            {st.last_sync_result ? ` · ${st.last_sync_result.pendientes} lead(s) por agendar` : ''}
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
                        <Label>Equipo de Callbell</Label>
                        <div className="flex gap-2">
                            <select value={teamUuid} onChange={(e) => setTeamUuid(e.target.value)} data-testid="callbell-team"
                                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
                                <option value="">Todos los equipos</option>
                                {(teams || []).map(t => <option key={t.uuid} value={t.uuid}>{t.name}</option>)}
                            </select>
                            <Button variant="outline" size="sm" onClick={loadTeams} disabled={!st.token_configured || busy === 'teams'} title="Traer equipos de Callbell">
                                {busy === 'teams' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>Etiqueta del lead agendado</Label>
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

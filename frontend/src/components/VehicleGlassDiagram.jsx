import React from 'react';

// Zonas de vidrio que mide el técnico (mismas claves que backend MEASURE_ZONES)
export const MEASURE_ZONES = [
    { id: 'panoramico', n: 1, label: 'Panorámico', hint: 'Solo hay un material' },
    { id: 'trasero', n: 2, label: 'Trasero / Luneta' },
    { id: 'laterales', n: 3, label: 'Laterales' },
    { id: 'sunroof', n: 4, label: 'Sunroof' },
];

// Vista 3/4 en proyección oblicua (frente a la izquierda). Profundidad = (45, -28).
const GLASS = {
    panoramico: ['M210,170 L285,115 L330,87 L255,142 Z'],
    trasero: ['M420,112 L500,160 L545,132 L465,84 Z'],
    laterales: [
        'M228,168 L287,124 L345,123 L345,166 Z',
        'M355,166 L355,123 L414,121 L478,162 Z',
    ],
    sunroof: ['M318,107 L398,105 L425,89 L345,91 Z'],
};
const BADGE = {
    panoramico: [262, 128],
    trasero: [482, 122],
    laterales: [350, 146],
    sunroof: [372, 98],
};

const zoneColors = (state, active) => {
    if (state === 'na') return { fill: 'url(#na-hatch)', stroke: '#64748b' };
    if (state === 'done') return { fill: active ? '#34d399' : '#10b981', stroke: '#6ee7b7' };
    return { fill: active ? '#22d3ee' : 'url(#glass)', stroke: active ? '#a5f3fc' : '#7dd3fc' };
};

/**
 * Carro en 3D con las zonas de vidrio para medir.
 * Props: status { zoneId: 'pending' | 'done' | 'na' }, active (zoneId), onSelect(zoneId)
 */
export const VehicleGlassDiagram = ({ status = {}, active, onSelect, className }) => (
    <svg viewBox="40 60 580 220" className={className} role="img" aria-label="Diagrama del vehículo con zonas de vidrio" data-testid="vehicle-glass-diagram">
        <defs>
            <linearGradient id="body-side" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#94a3b8" />
                <stop offset="0.55" stopColor="#64748b" />
                <stop offset="1" stopColor="#334155" />
            </linearGradient>
            <linearGradient id="body-top" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor="#cbd5e1" />
                <stop offset="1" stopColor="#e2e8f0" />
            </linearGradient>
            <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#0e7490" stopOpacity="0.85" />
                <stop offset="1" stopColor="#164e63" stopOpacity="0.95" />
            </linearGradient>
            <radialGradient id="rim" cx="0.4" cy="0.35" r="0.7">
                <stop offset="0" stopColor="#e5e7eb" />
                <stop offset="1" stopColor="#6b7280" />
            </radialGradient>
            <pattern id="na-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#1f2937" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="2" />
            </pattern>
        </defs>

        {/* Sombra */}
        <ellipse cx="325" cy="250" rx="270" ry="18" fill="#000" opacity="0.35" />

        {/* Caras frontal y trasera (profundidad) */}
        <path d="M60,200 L75,185 L120,157 L108,178 L104,206 L60,232 Z" fill="#475569" stroke="#334155" />
        <path d="M555,165 L600,137 L607,158 L608,200 L565,228 L565,185 Z" fill="#3f4b5e" stroke="#334155" />
        <path d="M588,152 L603,143 L604,156 L589,165 Z" fill="#f87171" stroke="#991b1b" />

        {/* Techo, capó y baúl (planos superiores) */}
        <path d="M75,185 L210,170 L255,142 L120,157 Z" fill="url(#body-top)" stroke="#475569" />
        <path d="M285,115 L420,112 L465,84 L330,87 Z" fill="url(#body-top)" stroke="#475569" />
        <path d="M500,160 L555,165 L600,137 L545,132 Z" fill="url(#body-top)" stroke="#475569" />

        {/* Costado del carro */}
        <path d="M60,200 L75,185 L210,170 L500,160 L555,165 L565,185 L565,228 L520,232 Q470,182 420,232 L200,236 Q150,186 100,236 L60,232 Z"
            fill="url(#body-side)" stroke="#334155" />
        {/* Pilares de la cabina */}
        <path d="M210,170 L285,115 L420,112 L500,160 Z" fill="#475569" stroke="#334155" />
        {/* Línea de puertas y manijas */}
        <path d="M350,170 L350,228 M228,172 L232,230" stroke="#1e293b" strokeWidth="1.5" />
        <rect x="300" y="182" width="18" height="4" rx="2" fill="#1e293b" />
        <rect x="405" y="180" width="18" height="4" rx="2" fill="#1e293b" />
        {/* Faros */}
        <path d="M62,198 L76,188 L110,186 L104,197 Z" fill="#fde68a" stroke="#a16207" />
        <path d="M548,170 L564,186 L564,196 L548,190 Z" fill="#f87171" stroke="#991b1b" />

        {/* Ruedas */}
        {[[150, 236], [470, 232]].map(([cx, cy]) => (
            <g key={cx}>
                <circle cx={cx} cy={cy} r="31" fill="#0f172a" />
                <circle cx={cx} cy={cy} r="19" fill="url(#rim)" stroke="#374151" />
                <circle cx={cx} cy={cy} r="5" fill="#374151" />
            </g>
        ))}

        {/* Zonas de vidrio */}
        {MEASURE_ZONES.map(z => {
            const c = zoneColors(status[z.id] || 'pending', active === z.id);
            return (
                <g
                    key={z.id}
                    onClick={() => onSelect?.(z.id)}
                    style={{ cursor: onSelect ? 'pointer' : 'default' }}
                    data-testid={`zone-${z.id}`}
                >
                    {GLASS[z.id].map((d, i) => (
                        <path key={i} d={d} fill={c.fill} stroke={c.stroke} strokeWidth={active === z.id ? 2.5 : 1.5} />
                    ))}
                </g>
            );
        })}
        {/* Reflejo */}
        <path d="M228,160 L268,131 L278,131 L238,160 Z" fill="#fff" opacity="0.18" pointerEvents="none" />

        {/* Numeración de zonas */}
        {MEASURE_ZONES.map(z => {
            const [x, y] = BADGE[z.id];
            const st = status[z.id] || 'pending';
            return (
                <g key={z.id} onClick={() => onSelect?.(z.id)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                    <circle cx={x} cy={y} r="10" fill={st === 'done' ? '#059669' : st === 'na' ? '#475569' : '#f59e0b'} stroke="#0f172a" strokeWidth="2" />
                    <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">{z.n}</text>
                </g>
            );
        })}
    </svg>
);

export default VehicleGlassDiagram;

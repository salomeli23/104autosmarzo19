import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

/**
 * LiveTimer — Shows elapsed time from a startTime in HH:MM:SS, updating every second.
 *
 * Props:
 *  - startTime: ISO timestamp string (UTC). If null/undefined, renders "--:--:--".
 *  - endTime: optional ISO timestamp string. If provided, the timer freezes at endTime - startTime.
 *  - label: short text label shown before the timer.
 *  - colorClass: tailwind text color class.
 *  - iconSize: tailwind size class for the icon (defaults to w-3 h-3).
 */
export const LiveTimer = ({ startTime, endTime = null, label = '', colorClass = 'text-cyan-400', iconSize = 'w-3 h-3', testId }) => {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        if (endTime) return; // frozen
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, [endTime]);

    if (!startTime) {
        return (
            <span className={`inline-flex items-center gap-1 text-xs ${colorClass}`} data-testid={testId}>
                <Clock className={iconSize} />
                {label && <span>{label}:</span>}
                <span className="font-mono">--:--:--</span>
            </span>
        );
    }

    const start = new Date(startTime).getTime();
    const reference = endTime ? new Date(endTime).getTime() : now.getTime();
    const elapsedMs = Math.max(0, reference - start);
    const totalSec = Math.floor(elapsedMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    return (
        <span className={`inline-flex items-center gap-1 text-xs ${colorClass}`} data-testid={testId}>
            <Clock className={iconSize} />
            {label && <span>{label}:</span>}
            <span className="font-mono font-semibold">{formatted}</span>
        </span>
    );
};

export default LiveTimer;

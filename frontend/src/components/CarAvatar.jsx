import React from 'react';
import { Car } from 'lucide-react';

/**
 * Avatar de perfil del vehículo. Muestra la foto frontal del check-in
 * o un icono de auto si no existe.
 */
export const CarAvatar = ({ photoUrl, size = 48, className = '', alt = 'Vehículo' }) => {
    const px = `${size}px`;
    if (photoUrl) {
        return (
            <img
                src={photoUrl}
                alt={alt}
                style={{ width: px, height: px }}
                className={`rounded-lg object-cover border border-border bg-muted ${className}`}
            />
        );
    }
    return (
        <div
            style={{ width: px, height: px }}
            className={`rounded-lg flex items-center justify-center bg-primary/20 border border-primary/30 ${className}`}
        >
            <Car className="text-primary" style={{ width: size * 0.5, height: size * 0.5 }} />
        </div>
    );
};

export default CarAvatar;

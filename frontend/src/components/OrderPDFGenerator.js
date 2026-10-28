import { partsWithOpacity } from '../lib/opacity';
import jsPDF from 'jspdf';
import { CHECKIN_NOTICES } from '../lib/utils';

/**
 * Genera el PDF de la orden. Si order.signature_url existe, imprime la firma del cliente.
 * options.download (por defecto true) descarga el archivo; siempre devuelve el PDF como data URI.
 */
export const generateOrderPDF = async (order, { download = true } = {}) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let yPos = 15;

    // Colors
    const primaryColor = [0, 180, 216]; // Cyan
    const darkColor = [30, 30, 50];

    // Header with company info
    doc.setFillColor(30, 30, 50);
    doc.rect(0, 0, pageWidth, 35, 'F');
    
    // Company name
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('POLARIZADOS MANAGER', margin, 18);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Polarizado | Nanoceramica | Autobahn Black CE | Ultrasecure', margin, 26);

    // Order number box
    doc.setFillColor(...primaryColor);
    doc.rect(pageWidth - 60, 5, 50, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text('ORDEN DE PEDIDO', pageWidth - 55, 12);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`#${order.order_code || 'N/A'}`, pageWidth - 55, 22);

    yPos = 45;

    // Date and time
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const now = new Date();
    doc.text(`Fecha: ${order.date || now.toLocaleDateString('es-CO')}`, margin, yPos);
    doc.text(`Hora: ${order.scheduled_time || now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`, pageWidth - 60, yPos);

    yPos += 10;

    // Section: Client Data
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('DATOS DEL CLIENTE', margin + 3, yPos + 6);
    yPos += 12;

    // Client info
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Nombre:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.client_name || 'N/A', margin + 25, yPos);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Telefono:', pageWidth / 2, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.client_phone || 'N/A', pageWidth / 2 + 25, yPos);
    
    yPos += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Cedula/NIT:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.client_id_number || 'N/A', margin + 25, yPos);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Email:', pageWidth / 2, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.client_email || 'N/A', pageWidth / 2 + 25, yPos);

    yPos += 12;

    // Section: Vehicle Data
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('DATOS DEL VEHICULO', margin + 3, yPos + 6);
    yPos += 12;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Placa:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.plate || 'N/A', margin + 20, yPos);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Marca:', pageWidth / 2, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.brand || 'N/A', pageWidth / 2 + 20, yPos);
    
    yPos += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Modelo:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.model || 'N/A', margin + 20, yPos);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Color:', pageWidth / 2, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(order.color || 'N/A', pageWidth / 2 + 20, yPos);

    yPos += 12;

    // Section: Services/Products
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('PRODUCTOS / SERVICIOS', margin + 3, yPos + 6);
    yPos += 12;

    // Services table header
    doc.setFillColor(30, 30, 50);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('#', margin + 3, yPos + 6);
    doc.text('Descripcion', margin + 15, yPos + 6);
    doc.text('Valor', pageWidth - 35, yPos + 6);
    yPos += 10;

    // Services rows
    doc.setTextColor(0, 0, 0);
    const services = order.services || [];
    services.forEach((svc, idx) => {
        const name = svc.description || svc.service || 'Servicio';
        const displayName = name;
        const price = `$${(svc.price || 0).toLocaleString('es-CO')}`;
        // Vidrios con la opacidad elegida por el cliente (y partes de PPF)
        const detail = [
            partsWithOpacity(svc).join(' · '),
            (svc.ppf_parts || []).length ? `Partes PPF: ${svc.ppf_parts.join(', ')}` : '',
        ].filter(Boolean).join(' | ');
        let detailLines = [];
        if (detail) {
            doc.setFontSize(7);
            detailLines = doc.splitTextToSize(`Opacidad / partes: ${detail}`, pageWidth - 80);
        }
        const rowHeight = 8 + detailLines.length * 3.5;
        
        // Alternate row color
        if (idx % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(margin, yPos - 2, pageWidth - 2 * margin, rowHeight, 'F');
        }
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text((idx + 1).toString(), margin + 3, yPos + 4);
        
        // Truncate long names
        const maxWidth = pageWidth - 80;
        let truncatedName = displayName;
        if (doc.getTextWidth(displayName) > maxWidth) {
            while (doc.getTextWidth(truncatedName + '...') > maxWidth && truncatedName.length > 0) {
                truncatedName = truncatedName.slice(0, -1);
            }
            truncatedName += '...';
        }
        doc.text(truncatedName, margin + 15, yPos + 4);
        doc.text(price, pageWidth - 35, yPos + 4);
        if (detailLines.length) {
            doc.setFontSize(7);
            doc.setTextColor(30, 64, 175);
            doc.text(detailLines, margin + 15, yPos + 7.5);
            doc.setTextColor(0, 0, 0);
        }
        yPos += rowHeight;
    });

    // Custom services if any
    if (order.custom_services) {
        const customItems = order.custom_services.split(',').map(s => s.trim());
        customItems.forEach((item, idx) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.text((services.length + idx + 1).toString(), margin + 3, yPos + 4);
            doc.text(`${item} (Personalizado)`, margin + 15, yPos + 4);
            doc.text('-', pageWidth - 35, yPos + 4);
            yPos += 8;
        });
    }

    yPos += 5;

    // Total
    const total = order.negotiated_value || order.total_value || services.reduce((sum, s) => sum + (s.price || 0), 0);
    doc.setFillColor(...primaryColor);
    doc.rect(pageWidth - 75, yPos, 60, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL: $${total.toLocaleString('es-CO')}`, pageWidth - 70, yPos + 7);

    yPos += 18;

    // Avisos importantes (en rojo), confirmados con el cliente en el check-in
    const noticeWidth = pageWidth - 2 * margin - 6;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const noticeLines = CHECKIN_NOTICES.map((n, idx) => doc.splitTextToSize(`${idx + 1}. ${n}`, noticeWidth));
    const noticesHeight = 9 + noticeLines.reduce((h, lines) => h + lines.length * 4, 0) + 2;
    doc.setDrawColor(220, 38, 38);
    doc.setFillColor(254, 242, 242);
    doc.rect(margin, yPos, pageWidth - 2 * margin, noticesHeight, 'FD');
    doc.setTextColor(220, 38, 38);
    doc.setFontSize(9);
    doc.text('AVISOS IMPORTANTES', margin + 3, yPos + 6);
    doc.setFontSize(8);
    let noticeY = yPos + 11;
    noticeLines.forEach(lines => {
        doc.text(lines, margin + 3, noticeY);
        noticeY += lines.length * 4;
    });
    doc.setDrawColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    yPos += noticesHeight + 6;

    // Legal notes
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 32, 'F');
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    
    const legalNotes = [
        '- El vehiculo permanecera en las instalaciones por cuenta y riesgo del cliente.',
        '- POLARIZADOS MANAGER no se hace responsable por objetos dejados en el vehiculo.',
        '- Al firmar este documento, el cliente acepta los terminos y condiciones del servicio.',
        '- La garantia aplica segun el tipo de servicio contratado.',
    ];
    
    legalNotes.forEach((note, idx) => {
        doc.text(note, margin + 3, yPos + 5 + (idx * 6));
    });

    yPos += 38;

    // Signatures (pasan a otra página si no caben)
    if (yPos + 50 > doc.internal.pageSize.getHeight() - 12) {
        doc.addPage();
        yPos = 20;
    }
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    
    // Client signature
    if (order.signature_url) {
        try {
            doc.addImage(order.signature_url, 'PNG', margin + 19, yPos - 5, 32, 16);
        } catch (e) {
            console.error('No se pudo imprimir la firma en el PDF:', e);
        }
    }
    doc.line(margin, yPos + 12, margin + 70, yPos + 12);
    doc.text('Firma del Cliente', margin + 20, yPos + 17);
    doc.text(`Cedula: ${order.client_id_number || '________________'}`, margin, yPos + 23);

    // Advisor signature
    doc.line(pageWidth - 85, yPos + 12, pageWidth - margin, yPos + 12);
    doc.text('Firma del Asesor', pageWidth - 65, yPos + 17);

    // Delivery date
    yPos += 30;
    doc.setFont('helvetica', 'bold');
    doc.text('Fecha estimada de entrega:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text('_______________________', margin + 50, yPos);

    // Footer
    const footerY = doc.internal.pageSize.getHeight() - 10;
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('POLARIZADOS MANAGER - Documento generado automaticamente', pageWidth / 2, footerY, { align: 'center' });

    // Save the PDF
    if (download) {
        doc.save(`Orden_${order.order_code || 'pedido'}_${order.plate || ''}.pdf`);
    }

    return doc.output('datauristring');
};

export default generateOrderPDF;

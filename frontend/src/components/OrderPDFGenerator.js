import jsPDF from 'jspdf';
import 'jspdf-autotable';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_techgarage-app/artifacts/8kw8x7h6_Captura%20de%20Pantalla%202026-01-30%20a%20la%28s%29%2011.36.02%20a.%C2%A0m..png";

export const generateOrderPDF = async (order) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let yPos = 15;

    // Colors
    const primaryColor = [0, 180, 216]; // Cyan
    const darkColor = [30, 30, 50];
    const grayColor = [100, 100, 100];

    // Helper function to add text
    const addText = (text, x, y, options = {}) => {
        doc.setFontSize(options.size || 10);
        doc.setFont('helvetica', options.style || 'normal');
        if (options.color) doc.setTextColor(...options.color);
        else doc.setTextColor(0, 0, 0);
        doc.text(text, x, y);
    };

    // Header with logo placeholder and company info
    doc.setFillColor(30, 30, 50);
    doc.rect(0, 0, pageWidth, 35, 'F');
    
    // Company name
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('POLARIZADOS MANAGER', margin, 18);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Polarizado • Nanocerámica • Autobahn Black CE • Ultrasecure', margin, 26);

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
    doc.text('DATOS DEL CLIENTE', margin + 3, yPos + 6);
    yPos += 12;

    // Client info in two columns
    const clientData = [
        ['Nombre:', order.client_name || 'N/A'],
        ['Teléfono:', order.client_phone || 'N/A'],
        ['Cédula/NIT:', order.client_id_number || 'N/A'],
        ['Email:', order.client_email || 'N/A'],
    ];

    doc.setFontSize(9);
    clientData.forEach((item, idx) => {
        const xOffset = idx % 2 === 0 ? margin : pageWidth / 2;
        const yOffset = yPos + Math.floor(idx / 2) * 6;
        doc.setFont('helvetica', 'bold');
        doc.text(item[0], xOffset, yOffset);
        doc.setFont('helvetica', 'normal');
        doc.text(item[1], xOffset + 25, yOffset);
    });

    yPos += 18;

    // Section: Vehicle Data
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('DATOS DEL VEHÍCULO', margin + 3, yPos + 6);
    yPos += 12;

    const vehicleData = [
        ['Placa:', order.plate || 'N/A'],
        ['Marca:', order.brand || 'N/A'],
        ['Modelo:', order.model || 'N/A'],
        ['Color:', order.color || 'N/A'],
    ];

    doc.setFontSize(9);
    vehicleData.forEach((item, idx) => {
        const xOffset = idx % 2 === 0 ? margin : pageWidth / 2;
        const yOffset = yPos + Math.floor(idx / 2) * 6;
        doc.setFont('helvetica', 'bold');
        doc.text(item[0], xOffset, yOffset);
        doc.setFont('helvetica', 'normal');
        doc.text(item[1], xOffset + 20, yOffset);
    });

    yPos += 18;

    // Section: Services/Products
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('PRODUCTOS / SERVICIOS', margin + 3, yPos + 6);
    yPos += 12;

    // Services table
    const services = order.services || [];
    const servicesTableData = services.map((svc, idx) => {
        const name = svc.description || svc.service || 'Servicio';
        const parts = svc.parts && svc.parts.length > 0 ? `(${svc.parts.join(', ')})` : '';
        return [
            (idx + 1).toString(),
            `${name} ${parts}`,
            `$${(svc.price || 0).toLocaleString('es-CO')}`
        ];
    });

    // Add custom services if any
    if (order.custom_services) {
        const customItems = order.custom_services.split(',').map(s => s.trim());
        customItems.forEach((item, idx) => {
            servicesTableData.push([
                (services.length + idx + 1).toString(),
                `${item} (Personalizado)`,
                '-'
            ]);
        });
    }

    if (servicesTableData.length > 0) {
        doc.autoTable({
            startY: yPos,
            head: [['#', 'Descripción', 'Valor']],
            body: servicesTableData,
            theme: 'grid',
            headStyles: { fillColor: [30, 30, 50], fontSize: 9 },
            bodyStyles: { fontSize: 8 },
            columnStyles: {
                0: { cellWidth: 10, halign: 'center' },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 30, halign: 'right' }
            },
            margin: { left: margin, right: margin }
        });
        yPos = doc.lastAutoTable.finalY + 5;
    }

    // Total
    const total = order.negotiated_value || order.total_value || services.reduce((sum, s) => sum + (s.price || 0), 0);
    doc.setFillColor(...primaryColor);
    doc.rect(pageWidth - 75, yPos, 60, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL: $${total.toLocaleString('es-CO')}`, pageWidth - 70, yPos + 7);

    yPos += 18;

    // Section: Vehicle Condition Check
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('VERIFICACIÓN DEL VEHÍCULO', margin + 3, yPos + 6);
    yPos += 12;

    // Interior items
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Interior:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    yPos += 5;
    
    const interiorItems = ['Radio', 'Antena', 'Espejos', 'Encendedor', 'Tapetes', 'Herramientas', 'Gato', 'Llanta Repuesto'];
    interiorItems.forEach((item, idx) => {
        const xOffset = margin + (idx % 4) * 45;
        const yOffset = yPos + Math.floor(idx / 4) * 5;
        doc.rect(xOffset, yOffset - 3, 3, 3);
        doc.text(item, xOffset + 5, yOffset);
    });
    
    yPos += 15;

    // Exterior items
    doc.setFont('helvetica', 'bold');
    doc.text('Exterior:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    yPos += 5;
    
    const exteriorItems = ['Antena', 'Plumillas', 'Pito', 'Emblemas', 'Espejos', 'Stops', 'Exploradoras', 'Rayones'];
    exteriorItems.forEach((item, idx) => {
        const xOffset = margin + (idx % 4) * 45;
        const yOffset = yPos + Math.floor(idx / 4) * 5;
        doc.rect(xOffset, yOffset - 3, 3, 3);
        doc.text(item, xOffset + 5, yOffset);
    });

    yPos += 18;

    // Legal notes
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 35, 'F');
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    
    const legalNotes = [
        '• El vehículo permanecerá en las instalaciones por cuenta y riesgo del cliente.',
        '• POLARIZADOS MANAGER no se hace responsable por objetos dejados en el vehículo.',
        '• Al firmar este documento, el cliente acepta los términos y condiciones del servicio.',
        '• La garantía aplica según el tipo de servicio contratado.',
        '• El cliente autoriza la instalación de los productos acordados en esta orden de pedido.',
    ];
    
    legalNotes.forEach((note, idx) => {
        doc.text(note, margin + 3, yPos + 5 + (idx * 6));
    });

    yPos += 42;

    // Signatures
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    
    // Client signature
    doc.line(margin, yPos + 15, margin + 70, yPos + 15);
    doc.text('Firma del Cliente', margin + 20, yPos + 20);
    doc.text(`Cédula: ${order.client_id_number || '________________'}`, margin, yPos + 26);

    // Advisor signature
    doc.line(pageWidth - 85, yPos + 15, pageWidth - margin, yPos + 15);
    doc.text('Firma del Asesor', pageWidth - 65, yPos + 20);

    // Delivery date
    yPos += 35;
    doc.setFont('helvetica', 'bold');
    doc.text('Fecha estimada de entrega:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text('_______________________', margin + 50, yPos);

    // Footer
    const footerY = doc.internal.pageSize.getHeight() - 10;
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('POLARIZADOS MANAGER - Documento generado automáticamente', pageWidth / 2, footerY, { align: 'center' });

    // Save the PDF
    doc.save(`Orden_${order.order_code || 'pedido'}_${order.plate || ''}.pdf`);
    
    return true;
};

export default generateOrderPDF;

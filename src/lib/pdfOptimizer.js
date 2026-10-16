import sharp from 'sharp';

/**
 * Optimiza buffers de archivos PDF que contengan imágenes crudas o sin comprimir
 * (típico de exportaciones de bancos como BBVA Net Cash o Telecrédito BCP).
 * Si el PDF contiene streams de imagen sin compresión (/Subtype /Image sin /Filter /DCTDecode),
 * extrae los mapas de bits, los comprime a JPEG (calidad 85%) y reconstruye un PDF estándar ligero.
 * 
 * Si el PDF ya está comprimido o es texto vectorial puro, retorna el buffer original intacto.
 * 
 * @param {Buffer} pdfBuffer - Buffer binario del archivo PDF
 * @param {string} fileName - Nombre del archivo
 * @returns {Promise<Buffer>} Buffer del PDF optimizado (o el original si no requiere optimización)
 */
export async function optimizePdfBuffer(pdfBuffer, fileName = 'documento.pdf') {
  if (!pdfBuffer || pdfBuffer.length < 500000) {
    // Si pesa menos de 500 KB, no requiere optimización
    return pdfBuffer;
  }

  try {
    const content = pdfBuffer.toString('binary');
    
    // Detectar si contiene imágenes crudas DeviceRGB con longitud fija
    const imgRegex = /<<[^>]*\/Subtype\s*\/Image[^>]*\/Width\s+(\d+)[^>]*\/Height\s+(\d+)[^>]*\/ColorSpace\s*\/DeviceRGB[^>]*\/BitsPerComponent\s+8[^>]*\/Length\s+(\d+)[^>]*>>/g;
    
    const imageMatches = [];
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);
      const length = parseInt(match[3], 10);
      
      // Verificar si el stream es un mapa de bits 24-bit RGB crudo (Width * Height * 3 === Length)
      if (width * height * 3 === length) {
        imageMatches.push({
          fullHeader: match[0],
          width,
          height,
          length,
          headerIndex: match.index
        });
      }
    }

    if (imageMatches.length === 0) {
      // No contiene streams crudos identificables; retornar original
      return pdfBuffer;
    }

    console.log(`[PdfOptimizer] Optimizando PDF "${fileName}" (${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB)... Detectadas ${imageMatches.length} imágenes crudas.`);

    // Encontrar cada stream en el buffer binario
    const compressedImages = [];
    for (const img of imageMatches) {
      const streamMarker = Buffer.from('stream\r\n');
      const streamMarkerAlt = Buffer.from('stream\n');
      
      let streamStart = pdfBuffer.indexOf(streamMarker, img.headerIndex);
      let markerLen = streamMarker.length;
      if (streamStart === -1 || streamStart > img.headerIndex + 500) {
        streamStart = pdfBuffer.indexOf(streamMarkerAlt, img.headerIndex);
        markerLen = streamMarkerAlt.length;
      }

      if (streamStart !== -1) {
        const rawData = pdfBuffer.subarray(streamStart + markerLen, streamStart + markerLen + img.length);
        const jpegBuffer = await sharp(rawData, {
          raw: { width: img.width, height: img.height, channels: 3 }
        })
          .jpeg({ quality: 85 })
          .toBuffer();

        compressedImages.push({
          width: img.width,
          height: img.height,
          jpegBuffer
        });
      }
    }

    if (compressedImages.length !== imageMatches.length || compressedImages.length === 0) {
      console.warn('[PdfOptimizer] No se pudieron extraer todos los streams; se mantiene PDF original.');
      return pdfBuffer;
    }

    // Reconstruir un PDF limpio y 100% estándar con las imágenes comprimidas en JPEG
    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const objOffsets = [];

    function addObj(contentStrOrBuf) {
      objOffsets.push(Buffer.byteLength(pdf, 'latin1'));
      if (typeof contentStrOrBuf === 'string') {
        pdf += contentStrOrBuf;
      } else {
        pdf += contentStrOrBuf.toString('latin1');
      }
    }

    // Objeto 1: Catalog
    addObj('1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n');

    // Objeto 2: Pages
    const count = compressedImages.length;
    const kidsStr = compressedImages.map((_, i) => `${3 + i} 0 R`).join(' ');
    addObj(`2 0 obj\n<</Type /Pages /Kids [${kidsStr}] /Count ${count}>>\nendobj\n`);

    // Páginas (Objetos 3 a 3 + count - 1)
    const imgStartObj = 3 + count;
    const contentStartObj = imgStartObj + count;

    for (let i = 0; i < count; i++) {
      const pageNum = 3 + i;
      const imgObjNum = imgStartObj + i;
      const contentObjNum = contentStartObj + i;
      addObj(`${pageNum} 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /I${i} ${imgObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R>>\nendobj\n`);
    }

    // Objetos de Imagen JPEG (XObjects)
    for (let i = 0; i < count; i++) {
      const img = compressedImages[i];
      const imgObjNum = imgStartObj + i;
      const imgHeader = `${imgObjNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpegBuffer.length} >>\nstream\n`;
      const imgFooter = '\nendstream\nendobj\n';

      objOffsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += imgHeader + img.jpegBuffer.toString('latin1') + imgFooter;
    }

    // Objetos de Contenido (Content streams con escalado proporcional a Letter 612x792)
    for (let i = 0; i < count; i++) {
      const img = compressedImages[i];
      const contentObjNum = contentStartObj + i;
      
      // Proporción de aspecto para ajustar dentro de márgenes de 18pt en Letter (ancho útil = 576)
      const targetWidth = 576;
      const targetHeight = Math.min(756, Math.round((img.height * targetWidth) / img.width));
      const posY = 792 - 18 - targetHeight;

      const c = `q\n${targetWidth} 0 0 ${targetHeight} 18 ${posY} cm\n/I${i} Do\nQ\n`;
      addObj(`${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}endstream\nendobj\n`);
    }

    // XREF y Trailer
    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    const totalObjs = 3 + (count * 2);
    let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
    for (let i = 0; i < objOffsets.length; i++) {
      xref += String(objOffsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    pdf += xref;

    const optimizedBuffer = Buffer.from(pdf, 'latin1');
    console.log(`[PdfOptimizer] PDF "${fileName}" optimizado con éxito: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB → ${(optimizedBuffer.length / 1024).toFixed(1)} KB (Reducción: ${((1 - optimizedBuffer.length / pdfBuffer.length) * 100).toFixed(1)}%).`);
    return optimizedBuffer;
  } catch (err) {
    console.warn(`[PdfOptimizer] No se pudo optimizar PDF (${err.message}). Se usará el original.`);
    return pdfBuffer;
  }
}

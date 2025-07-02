class PacketAnalysisModal {
    constructor() {
        this.socket = io();
        this.currentPacketId = null;
        this.createModal();
        this.bindEvents();
    }
    
    createModal() {
        if (!document.getElementById('packetAnalysisModal')) {
            const modalHTML = `
                <div class="modal-overlay" id="packetAnalysisModal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2>Network Analyzer</h2>
                            <button class="close-btn" id="closeModal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="packet-info">
                                <h3>Packet Information</h3>
                                <div class="info-grid" id="packetInfo"></div>
                            </div>
                            <div class="analysis-content">
                                <div class="event-detail">
                                    <h3>Event Detail</h3>
                                    <div class="detail-content" id="eventDetail"></div>
                                </div>
                                <div class="hex-dump">
                                    <h3>Hex Dump</h3>
                                    <div class="hex-content" id="hexDump"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
        
        this.modal = document.getElementById('packetAnalysisModal');
        this.closeBtn = document.getElementById('closeModal');
        this.packetInfo = document.getElementById('packetInfo');
        this.hexDump = document.getElementById('hexDump');
        this.eventDetail = document.getElementById('eventDetail');
    }
    
    bindEvents() {
        this.closeBtn.addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.style.display === 'block') {
                this.close();
            }
        });
        
        this.socket.on('packetAnalysis', (data) => this.handleAnalysisResult(data));
        this.socket.on('packetAnalysisError', (error) => this.handleAnalysisError(error));
    }
    
    show(packetId) {
        this.currentPacketId = packetId;
        this.modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        this.showLoading();
        this.socket.emit('requestPacketAnalysis', packetId);
    }
    
    close() {
        this.modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        this.currentPacketId = null;
    }
    
    showLoading() {
        const loadingHTML = '<div class="loading">Analyzing packet...</div>';
        this.packetInfo.innerHTML = loadingHTML;
        this.hexDump.innerHTML = loadingHTML;
        this.eventDetail.innerHTML = loadingHTML;
    }
    
    handleAnalysisResult(data) {
        if (data.success) {
            this.renderPacketInfo(data.packet);
            this.renderHexDump(data.analysis.rawData);
            this.renderEventDetail(data.analysis.layers);
        } else {
            this.handleAnalysisError('Unable to analyze packet');
        }
    }
    
    handleAnalysisError(error) {
        const errorHtml = `<div class="error-message">Error: ${error}</div>`;
        this.packetInfo.innerHTML = errorHtml;
        this.hexDump.innerHTML = errorHtml;
        this.eventDetail.innerHTML = errorHtml;
    }
    
    renderPacketInfo(packet) {
        const timestamp = new Date(packet.timestamp).toLocaleString();
        const infoHtml = `
            <div class="info-item">
                <span class="info-label">Packet ID:</span>
                <span class="info-value">${packet.id}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Type:</span>
                <span class="info-value">${packet.type}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Length:</span>
                <span class="info-value">${packet.packetLength} bytes</span>
            </div>
            <div class="info-item">
                <span class="info-label">Kit:</span>
                <span class="info-value">${packet.kitUnique}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Channel:</span>
                <span class="info-value">${packet.channel}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Timestamp:</span>
                <span class="info-value">${timestamp}</span>
            </div>
        `;
        this.packetInfo.innerHTML = infoHtml;
    }
    
    renderEventDetail(layers) {
        if (!layers || layers.length === 0) {
            console.log('DEBUG: layers =', layers);
    console.log('DEBUG: layers length =', layers ? layers.length : 'undefined');
            this.eventDetail.innerHTML = '<div class="error-message">No protocol analysis available</div>';
            return;
        }
        
        let html = '';
        layers.forEach((layer, index) => {
            html += this.renderLayer(layer, index);
        });
        
        this.eventDetail.innerHTML = html;
        this.bindDetailEvents();
    }
    
    renderLayer(layer, index) {
        const isExpanded = layer.expanded || false;
        let html = `
            <div class="layer">
                <div class="layer-header ${isExpanded ? 'expanded' : ''}" data-layer="${index}">
                    <span class="layer-toggle">${isExpanded ? '▼' : '▶'}</span>
                    <span class="layer-name">${layer.name} [${layer.totalBytes || 0} bytes]</span>
                </div>
                <div class="layer-content ${isExpanded ? 'expanded' : ''}">
        `;
        
        if (layer.fields && layer.fields.length > 0) {
            layer.fields.forEach((field) => {
                html += this.renderField(field);
            });
        }
        
        html += '</div></div>';
        return html;
    }
    
    renderField(field) {
        let html = '';
        
        if (field.type === 'expandable') {
            const hasSubfields = field.subfields && field.subfields.length > 0;
            const isExpanded = field.expanded || false;
            
            html += `
                <div class="field-item expandable" data-field-id="${field.name}">
                    <span class="field-toggle">${isExpanded ? '▼' : '▶'}</span>
                    <span class="field-name">${field.name}:</span>
                    <span class="field-value">${field.value}</span>
                    ${field.description ? `<span class="field-description">${field.description}</span>` : ''}
                </div>
            `;
            
            if (hasSubfields) {
                html += `<div class="subfields" style="display: ${isExpanded ? 'block' : 'none'};">`;
                field.subfields.forEach(subfield => {
                    html += this.renderSubfield(subfield);
                });
                html += '</div>';
            }
        } else {
            html += `
                <div class="field-item" data-field-id="${field.name}">
                    <span class="field-toggle"> </span>
                    <span class="field-name">${field.name}:</span>
                    <span class="field-value">${field.value}</span>
                    ${field.description ? `<span class="field-description">${field.description}</span>` : ''}
                </div>
            `;
        }
        
        return html;
    }
    
    renderSubfield(subfield) {
        let html = `
            <div class="subfield-item">
                <span class="subfield-name">${subfield.name}:</span>
                <span class="subfield-value">${subfield.value}</span>
                ${subfield.description ? `<span class="subfield-description">${subfield.description}</span>` : ''}
                ${subfield.binaryDisplay ? `<span class="subfield-binary">${subfield.binaryDisplay}</span>` : ''}
            </div>
        `;
        
        return html;
    }
    
    bindDetailEvents() {
        // Layer toggle events
        this.eventDetail.querySelectorAll('.layer-header').forEach(header => {
            header.addEventListener('click', (e) => {
                const content = header.nextElementSibling;
                const toggle = header.querySelector('.layer-toggle');
                
                if (content.classList.contains('expanded')) {
                    content.classList.remove('expanded');
                    header.classList.remove('expanded');
                    toggle.textContent = '▶';
                } else {
                    content.classList.add('expanded');
                    header.classList.add('expanded');
                    toggle.textContent = '▼';
                }
            });
        });
        
        // Field toggle events
        this.eventDetail.querySelectorAll('.field-item.expandable').forEach(fieldItem => {
            fieldItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const toggle = fieldItem.querySelector('.field-toggle');
                const subfields = fieldItem.nextElementSibling;
                
                if (subfields && subfields.classList.contains('subfields')) {
                    if (subfields.style.display === 'none') {
                        subfields.style.display = 'block';
                        toggle.textContent = '▼';
                        fieldItem.classList.add('expanded');
                    } else {
                        subfields.style.display = 'none';
                        toggle.textContent = '▶';
                        fieldItem.classList.remove('expanded');
                    }
                }
            });
        });
    }
    
    renderHexDump(hexData) {
        if (!hexData) {
            this.hexDump.innerHTML = '<div class="error-message">No hex data available</div>';
            return;
        }
        
        const bytes = hexData.match(/.{2}/g) || [];
        let html = '';
        
        for (let i = 0; i < bytes.length; i += 16) {
            const lineBytes = bytes.slice(i, i + 16);
            const offset = i.toString(16).padStart(4, '0').toUpperCase();
            
            let hexLine = '';
            let asciiLine = '';
            
            for (let j = 0; j < 16; j++) {
                if (j < lineBytes.length) {
                    const byte = lineBytes[j];
                    hexLine += `<span class="hex-byte" data-offset="${i + j}" title="Offset: ${i + j}, Value: 0x${byte}">${byte}</span>`;
                    
                    const charCode = parseInt(byte, 16);
                    const char = (charCode >= 32 && charCode <= 126) ? String.fromCharCode(charCode) : '.';
                    asciiLine += char;
                } else {
                    hexLine += '<span class="hex-byte">  </span>';
                    asciiLine += ' ';
                }
                
                // Add space every 4 bytes
                if ((j + 1) % 4 === 0 && j < 15) {
                    hexLine += ' ';
                }
            }
            
            html += `
                <div class="hex-line">
                    <span class="hex-offset">${offset}:</span>
                    <span class="hex-bytes">${hexLine}</span>
                    <span class="hex-ascii">${asciiLine}</span>
                </div>
            `;
        }
        
        this.hexDump.innerHTML = html;
        
        // Add click handlers for hex bytes
        this.hexDump.querySelectorAll('.hex-byte').forEach(byte => {
            byte.addEventListener('click', (e) => {
                const offset = parseInt(e.target.dataset.offset);
                if (!isNaN(offset)) {
                    this.highlightByte(offset);
                }
            });
        });
    }
    
    highlightByte(offset) {
        this.hexDump.querySelectorAll('.hex-byte.highlighted').forEach(byte => {
            byte.classList.remove('highlighted');
        });
        
        const targetByte = this.hexDump.querySelector(`[data-offset="${offset}"]`);
        if (targetByte) {
            targetByte.classList.add('highlighted');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.packetAnalysisModal = new PacketAnalysisModal();
});

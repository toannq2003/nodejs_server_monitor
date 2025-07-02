// packet-analyzer.js
class PacketAnalyzer {
    constructor() {
        this.PHR_LENGTHS = {
            '2.4GHz': 1,
            'Sub-GHz': 2
        };
    }

    analyzePacket(packetData, channel) {
        try {
            const buffer = Buffer.from(packetData, 'hex');
            const analysis = {
                rawData: packetData,
                totalLength: buffer.length,
                layers: [],
                errors: [],
                timestamp: new Date().toISOString()
            };

            this.analyzeNetworkAnalyzerFormat(buffer, analysis, channel);
            return analysis;
        } catch (error) {
            return {
                rawData: packetData,
                error: error.message,
                layers: [],
                timestamp: new Date().toISOString()
            };
        }
    }

    analyzeNetworkAnalyzerFormat(buffer, analysis, channel) {
        let offset = 0;
        
        // 1. IEEE 802.15.4 Layer - theo format Network Analyzer
        const ieee802154Layer = this.analyzeIEEE802154NetworkAnalyzer(buffer, offset, channel);
        analysis.layers.push(ieee802154Layer);
        
        // Tính offset sau IEEE 802.15.4
        const headerInfo = this.calculateIEEE802154Length(buffer, offset, channel);
        offset = headerInfo.nextOffset;

        // 2. IEEE 802.15.4 Security (nếu có)
        if (headerInfo.hasSecurityHeader && buffer.length > offset) {
            const securityLayer = this.analyzeIEEE802154SecurityNetworkAnalyzer(buffer, offset);
            if (securityLayer) {
                analysis.layers.push(securityLayer);
                offset += securityLayer.totalBytes;
            }
        }

        // 3. 6lowpan Layer (nếu có)
        if (buffer.length > offset) {
            const sixlowpanLayer = this.analyze6LowpanNetworkAnalyzer(buffer, offset);
            if (sixlowpanLayer) {
                analysis.layers.push(sixlowpanLayer);
                offset += sixlowpanLayer.totalBytes;
            }
        }

        // 4. ICMPv6 Layer (nếu có)
        if (buffer.length > offset) {
            const icmpLayer = this.analyzeICMPv6NetworkAnalyzer(buffer, offset);
            if (icmpLayer) {
                analysis.layers.push(icmpLayer);
                offset += icmpLayer.totalBytes;
            }
        }

        // 5. Application Payload (nếu còn data)
        if (buffer.length > offset + 4) { // Reserve 4 bytes for MIC
            const appLayer = this.analyzeApplicationPayloadNetworkAnalyzer(buffer, offset);
            if (appLayer) {
                analysis.layers.push(appLayer);
                offset += appLayer.totalBytes;
            }
        }

        // 6. MAC encryption MIC (luôn có ở cuối)
        if (buffer.length >= 4) {
            const micLayer = this.analyzeMACEncryptionMICNetworkAnalyzer(buffer);
            if (micLayer) {
                analysis.layers.push(micLayer);
            }
        }

        // 7. Radio Info EFR32 (nếu có - nhưng không có trong data của bạn)
    }

    analyzeIEEE802154NetworkAnalyzer(buffer, offset, channel) {
        const layer = {
            name: 'IEEE 802.15.4',
            totalBytes: 0,
            expanded: true,
            fields: []
        };

        let currentOffset = offset;
        const startOffset = currentOffset;
        
        // PHY Header - theo format Network Analyzer
        const phrLength = this.getPHRLength(channel);
        if (buffer.length >= currentOffset + phrLength) {
            const phrValue = phrLength === 1 ? buffer[currentOffset] : buffer.readUInt16LE(currentOffset);
            
            layer.fields.push({
                name: 'PHY Header',
                value: `0x${phrValue.toString(16).padStart(2, '0')}`,
                description: '',
                type: 'simple',
                subfields: [
                    {
                        name: 'Packet Length',
                        value: phrLength === 1 ? phrValue : (phrValue & 0x7FF),
                        description: `${phrLength === 1 ? phrValue : (phrValue & 0x7FF)}`,
                        binaryDisplay: this.formatBinaryDisplay(phrValue, phrLength * 8),
                        type: 'binary'
                    }
                ]
            });
            
            currentOffset += phrLength;
        }

        // Frame Control - chính xác theo Network Analyzer
        let frameControl = 0;
        if (buffer.length >= currentOffset + 2) {
            frameControl = buffer.readUInt16LE(currentOffset);
            
            const frameType = frameControl & 0x07;
            const securityEnabled = (frameControl >> 3) & 0x01;
            const framePending = (frameControl >> 4) & 0x01;
            const ackRequired = (frameControl >> 5) & 0x01;
            const panIdCompression = (frameControl >> 6) & 0x01;
            const reserved = (frameControl >> 7) & 0x07;
            const destAddrMode = (frameControl >> 10) & 0x03;
            const frameVersion = (frameControl >> 12) & 0x03;
            const srcAddrMode = (frameControl >> 14) & 0x03;

            const frameTypes = ['Beacon', 'Data', 'Acknowledgment', 'Command'];
            const addrModes = ['No PAN ID or address', 'Reserved', 'Short address', 'Extended address'];
            const versions = ['802.15.4-2003', '802.15.4-2006', '802.15.4-2015', 'Reserved'];

            layer.fields.push({
                name: 'Frame Control',
                value: `0x${frameControl.toString(16).padStart(4, '0')}`,
                description: '',
                type: 'expandable',
                expanded: false,
                subfields: [
                    {
                        name: 'Frame Type',
                        value: frameType,
                        description: `${frameTypes[frameType]} (${frameType})`,
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 0, 3, '........ .....001'),
                        type: 'binary'
                    },
                    {
                        name: 'Security Enabled',
                        value: securityEnabled,
                        description: securityEnabled ? 'true' : 'false',
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 3, 1, '........ ....1...'),
                        type: 'binary'
                    },
                    {
                        name: 'Frame Pending',
                        value: framePending,
                        description: framePending ? 'true' : 'false',
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 4, 1, '........ ...0....'),
                        type: 'binary'
                    },
                    {
                        name: 'Ack Required',
                        value: ackRequired,
                        description: ackRequired ? 'true' : 'false',
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 5, 1, '........ ..0.....'),
                        type: 'binary'
                    },
                    {
                        name: 'PAN ID Compression',
                        value: panIdCompression,
                        description: panIdCompression ? 'true' : 'false',
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 6, 1, '........ .1......'),
                        type: 'binary'
                    },
                    {
                        name: 'Reserved',
                        value: `0x${reserved.toString(16).padStart(2, '0')}`,
                        description: `0x${reserved.toString(16).padStart(2, '0')}`,
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 7, 3, '.....001 ........'),
                        type: 'binary'
                    },
                    {
                        name: 'Destination Address Mode',
                        value: destAddrMode,
                        description: `${addrModes[destAddrMode]} (${destAddrMode})`,
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 10, 2, '....10.. ........'),
                        type: 'binary'
                    },
                    {
                        name: 'Frame Version',
                        value: frameVersion,
                        description: `${versions[frameVersion]} (${frameVersion})`,
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 12, 2, '..01.... ........'),
                        type: 'binary'
                    },
                    {
                        name: 'Source Address Mode',
                        value: srcAddrMode,
                        description: `${addrModes[srcAddrMode]} (${srcAddrMode})`,
                        binaryDisplay: this.createBinaryDisplay(frameControl, 16, 14, 2, '11...... ........'),
                        type: 'binary'
                    }
                ]
            });
            
            currentOffset += 2;
        }

        // Sequence
        if (buffer.length > currentOffset) {
            layer.fields.push({
                name: 'Sequence',
                value: `0x${buffer[currentOffset].toString(16).padStart(2, '0')}`,
                description: '',
                type: 'simple'
            });
            currentOffset += 1;
        }

        // Addressing Fields
        const addressingInfo = this.parseAddressingFieldsNetworkAnalyzer(buffer, currentOffset, frameControl);
        layer.fields.push(...addressingInfo.fields);
        currentOffset = addressingInfo.nextOffset;

        layer.totalBytes = currentOffset - startOffset;
        return layer;
    }

    parseAddressingFieldsNetworkAnalyzer(buffer, offset, frameControl) {
        const fields = [];
        let currentOffset = offset;
        
        if (typeof frameControl === 'undefined' || frameControl === null) {
            return { fields, nextOffset: currentOffset };
        }
        
        const destAddrMode = (frameControl >> 10) & 0x03;
        const srcAddrMode = (frameControl >> 14) & 0x03;
        const panIdCompression = (frameControl >> 6) & 0x01;

        // Destination PAN ID
        if (destAddrMode !== 0 && buffer.length >= currentOffset + 2) {
            const destPanId = buffer.readUInt16LE(currentOffset);
            fields.push({
                name: 'Destination PAN ID',
                value: `0x${destPanId.toString(16).padStart(4, '0')}`,
                description: '',
                type: 'simple'
            });
            currentOffset += 2;
        }

        // Short/Long Destination Address
        if (destAddrMode === 2 && buffer.length >= currentOffset + 2) {
            const destAddr = buffer.readUInt16LE(currentOffset);
            fields.push({
                name: 'Short Destination Address',
                value: `0x${destAddr.toString(16).padStart(4, '0')}`,
                description: '',
                type: 'simple'
            });
            currentOffset += 2;
        } else if (destAddrMode === 3 && buffer.length >= currentOffset + 8) {
    const destAddr = buffer.subarray(currentOffset, currentOffset + 8);
    // Đảo ngược thứ tự byte để hiển thị đúng chuẩn (big-endian)
    const destAddrHex = Array.from(destAddr).reverse().map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    fields.push({
        name: 'Long Destination Address',
        value: destAddrHex,
        description: '',
        type: 'simple'
    });
    currentOffset += 8;
}

        // Source PAN ID (nếu không compressed)
        if (srcAddrMode !== 0 && !panIdCompression && buffer.length >= currentOffset + 2) {
            const srcPanId = buffer.readUInt16LE(currentOffset);
            fields.push({
                name: 'Source PAN ID',
                value: `0x${srcPanId.toString(16).padStart(4, '0')}`,
                description: '',
                type: 'simple'
            });
            currentOffset += 2;
        }

        // Short/Long Source Address
        if (srcAddrMode === 2 && buffer.length >= currentOffset + 2) {
            const srcAddr = buffer.readUInt16LE(currentOffset);
            fields.push({
                name: 'Short Source Address',
                value: `0x${srcAddr.toString(16).padStart(4, '0')}`,
                description: '',
                type: 'simple'
            });
            currentOffset += 2;
        } else if (srcAddrMode === 3 && buffer.length >= currentOffset + 8) {
    const srcAddr = buffer.subarray(currentOffset, currentOffset + 8);
    const srcAddrHex = Array.from(srcAddr).reverse().map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    fields.push({
        name: 'Long Source Address',
        value: srcAddrHex,
        description: '',
        type: 'simple'
    });
    currentOffset += 8;
}

        return { fields, nextOffset: currentOffset };
    }

    analyzeIEEE802154SecurityNetworkAnalyzer(buffer, offset) {
        const layer = {
            name: 'IEEE 802.15.4 Security',
            totalBytes: 0,
            expanded: true,
            fields: []
        };

        let currentOffset = offset;
        const startOffset = currentOffset;

        // Security Control
        if (buffer.length > currentOffset) {
            const securityControl = buffer[currentOffset];
            const securityLevel = securityControl & 0x07;
            const keyIdMode = (securityControl >> 3) & 0x03;

            layer.fields.push({
                name: 'Security Control',
                value: `0x${securityControl.toString(16).padStart(2, '0')}`,
                description: '',
                type: 'expandable',
                expanded: false,
                subfields: [
                    {
                        name: 'Security Level',
                        value: securityLevel,
                        description: `${this.getSecurityLevelDescription(securityLevel)} (${securityLevel})`,
                        binaryDisplay: this.createBinaryDisplay(securityControl, 8, 0, 3, '.....101'),
                        type: 'binary'
                    },
                    {
                        name: 'Key Identifier Mode',
                        value: keyIdMode,
                        description: `${this.getKeyIdModeDescription(keyIdMode)} (${keyIdMode})`,
                        binaryDisplay: this.createBinaryDisplay(securityControl, 8, 3, 2, '...01...'),
                        type: 'binary'
                    }
                ]
            });

            currentOffset += 1;
        }

        // Frame Counter
        if (buffer.length >= currentOffset + 4) {
            const frameCounter = buffer.readUInt32LE(currentOffset);
            layer.fields.push({
                name: 'Frame Counter',
                value: `0x${frameCounter.toString(16).padStart(8, '0')}`,
                description: '',
                type: 'simple'
            });
            currentOffset += 4;
        }

        // Key Source (nếu có)
        const securityControl = buffer[offset];
        const keyIdMode = (securityControl >> 3) & 0x03;
        
        if (keyIdMode === 2 && buffer.length >= currentOffset + 4) {
            const keySource = buffer.subarray(currentOffset, currentOffset + 4);
            layer.fields.push({
                name: 'Key Source (4 byte)',
                value: keySource.toString('hex').toUpperCase(),
                description: '',
                type: 'simple'
            });
            currentOffset += 4;
        } else if (keyIdMode === 3 && buffer.length >= currentOffset + 8) {
            const keySource = buffer.subarray(currentOffset, currentOffset + 8);
            layer.fields.push({
                name: 'Key Source (8 byte)',
                value: keySource.toString('hex').toUpperCase(),
                description: '',
                type: 'simple'
            });
            currentOffset += 8;
        }

        // Key Index
        if (keyIdMode > 0 && buffer.length > currentOffset) {
            layer.fields.push({
                name: 'Key Index',
                value: `0x${buffer[currentOffset].toString(16).padStart(2, '0')}`,
                description: '',
                type: 'simple'
            });
            currentOffset += 1;
        }

        layer.totalBytes = currentOffset - startOffset;
        return layer;
    }

    analyze6LowpanNetworkAnalyzer(buffer, offset) {
    if (buffer.length <= offset) return null;

    const layer = {
        name: '6lowpan',
        totalBytes: 0,
        expanded: true,
        fields: []
    };

    let currentOffset = offset;
    const startOffset = currentOffset;
    const dispatchByte = buffer[currentOffset];

    // IPHC Base Encoding
    if ((dispatchByte & 0xE0) === 0x60) {
        if (buffer.length >= currentOffset + 2) {
            const iphc = buffer.readUInt16BE(currentOffset);
            
            const tf = (iphc >> 11) & 0x03;
            const nh = (iphc >> 10) & 0x01;
            const hlim = (iphc >> 8) & 0x03;
            const cid = (iphc >> 7) & 0x01;
            const sac = (iphc >> 6) & 0x01;
            const sam = (iphc >> 4) & 0x03;
            const m = (iphc >> 3) & 0x01;
            const dac = (iphc >> 2) & 0x01;
            const dam = iphc & 0x03;

            layer.fields.push({
                name: 'IPHC Base Encoding',
                value: `0x${iphc.toString(16).padStart(4, '0').toUpperCase()}`,
                description: '',
                type: 'expandable',
                expanded: false,
                subfields: [
                    {
                        name: 'Traffic and Flow',
                        value: tf,
                        description: `${this.getTrafficFlowDescription(tf)} (${tf})`,
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 11, 2, '..11 .... .... ....'),
                        type: 'binary'
                    },
                    {
                        name: 'Next Header',
                        value: nh,
                        description: nh ? 'compressed (1)' : 'in-line (0)',
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 10, 1, '.... 1... .... ....'),
                        type: 'binary'
                    },
                    {
                        name: 'Hop Limit',
                        value: hlim,
                        description: `${this.getHopLimitDescription(hlim)} (${hlim})`,
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 8, 2, '.... .11. .... ....'),
                        type: 'binary'
                    },
                    {
                        name: 'Context ID',
                        value: cid,
                        description: cid ? 'in-line (1)' : '0 (0)',
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 7, 1, '.... ...0 .... ....'),
                        type: 'binary'
                    },
                    {
                        name: 'Source Compression',
                        value: sac,
                        description: sac ? 'context-based (1)' : 'stateless (0)',
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 6, 1, '.... .... 1... ....'),
                        type: 'binary'
                    },
                    {
                        name: 'Source Address Mode',
                        value: sam,
                        description: `${this.getAddressModeDescription(sam)} (${sam})`,
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 4, 2, '.... .... .01. ....'),
                        type: 'binary'
                    },
                    {
                        name: 'Multicast Compression',
                        value: m,
                        description: m ? 'true' : 'false',
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 3, 1, '.... .... ...1 ....'),
                        type: 'binary'
                    },
                    {
                        name: 'Destination Compression',
                        value: dac,
                        description: dac ? 'context-based (1)' : 'stateless (0)',
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 2, 1, '.... .... .... 1...'),
                        type: 'binary'
                    },
                    {
                        name: 'Destination Address Mode',
                        value: dam,
                        description: `${this.getDestAddressModeDescription(dam, m)} (${dam})`,
                        binaryDisplay: this.createBinaryDisplay(iphc, 16, 0, 2, '.... .... .... .11'),
                        type: 'binary'
                    }
                ]
            });

            currentOffset += 2;

            let destAddr = null;
if (m === 0) { // Unicast
    if (dam === 1 && buffer.length >= currentOffset + 8) {
        destAddr = {
            name: 'Destination Address',
            value: buffer.subarray(currentOffset, currentOffset + 8).toString('hex').toUpperCase(),
            description: '',
            type: 'simple'
        };
        currentOffset += 8;
    } else if (dam === 2 && buffer.length >= currentOffset + 2) {
        destAddr = {
            name: 'Destination Address',
            value: buffer.subarray(currentOffset, currentOffset + 2).toString('hex').toUpperCase(),
            description: '',
            type: 'simple'
        };
        currentOffset += 2;
    } else if (dam === 3 && buffer.length >= currentOffset + 1) {
        destAddr = {
            name: 'Destination Address',
            value: buffer[currentOffset].toString(16).padStart(2, '0').toUpperCase(),
            description: '',
            type: 'simple'
        };
        currentOffset += 1;
    }
} else if (m === 1) { // Multicast
    if (dam === 0 && buffer.length >= currentOffset + 16) {
        destAddr = {
            name: 'Destination Address',
            value: buffer.subarray(currentOffset, currentOffset + 16).toString('hex').toUpperCase(),
            description: '',
            type: 'simple'
        };
        currentOffset += 16;
    } else if (dam === 1 && buffer.length >= currentOffset + 6) {
        destAddr = {
            name: 'Destination Address',
            value: buffer.subarray(currentOffset, currentOffset + 6).toString('hex').toUpperCase(),
            description: '',
            type: 'simple'
        };
        currentOffset += 6;
    } else if (dam === 2 && buffer.length >= currentOffset + 4) {
        destAddr = {
            name: 'Destination Address',
            value: buffer.subarray(currentOffset, currentOffset + 4).toString('hex').toUpperCase(),
            description: '',
            type: 'simple'
        };
        currentOffset += 4;
    } else if (dam === 3 && buffer.length >= currentOffset + 1) {
        destAddr = {
            name: 'Destination Address',
            value: buffer[currentOffset].toString(16).padStart(2, '0').toUpperCase(),
            description: '',
            type: 'simple'
        };
        currentOffset += 1;
    }
}
if (destAddr) {
    layer.fields.push(destAddr);
}

        }
    }

    layer.totalBytes = currentOffset - startOffset;
    return layer.totalBytes > 0 ? layer : null;
}


    analyzeICMPv6NetworkAnalyzer(buffer, offset) {
        if (buffer.length <= offset + 4) return null;

        const layer = {
            name: 'ICMPv6',
            totalBytes: 4,
            expanded: true,
            fields: []
        };

        // Type
        const type = buffer[offset];
        const typeNames = {
            0x80: 'Echo Request',
            0x81: 'Echo Reply'
        };

        layer.fields.push({
            name: 'Type',
            value: `${typeNames[type] || 'Unknown'} (0x${type.toString(16).padStart(2, '0')})`,
            description: '',
            type: 'simple'
        });

        // Code
        layer.fields.push({
            name: 'Code',
            value: `0x${buffer[offset + 1].toString(16).padStart(2, '0')}`,
            description: '',
            type: 'simple'
        });

        // Checksum
        const checksum = buffer.readUInt16BE(offset + 2);
        layer.fields.push({
            name: 'Checksum',
            value: `0x${checksum.toString(16).padStart(4, '0')}`,
            description: '',
            type: 'simple'
        });

        return layer;
    }

    analyzeApplicationPayloadNetworkAnalyzer(buffer, offset) {
        if (buffer.length <= offset) return null;

        const remainingLength = buffer.length - offset - 4; // Reserve 4 bytes for MIC
        if (remainingLength <= 0) return null;

        const layer = {
            name: 'Application Payload',
            totalBytes: remainingLength,
            expanded: true,
            fields: []
        };

        layer.fields.push({
            name: 'Length',
            value: `${remainingLength} bytes`,
            description: '',
            type: 'simple'
        });

        return layer;
    }

    analyzeMACEncryptionMICNetworkAnalyzer(buffer) {
        if (buffer.length < 4) return null;

        const layer = {
            name: 'MAC encryption MIC',
            totalBytes: 4,
            expanded: true,
            fields: []
        };

        const mic = buffer.subarray(-4);
        layer.fields.push({
            name: 'MAC MIC',
            value: mic.toString('hex').toUpperCase(),
            description: '',
            type: 'simple'
        });

        return layer;
    }

    // Helper methods
    createBinaryDisplay(value, totalBits, startBit, bitCount, pattern) {
        const binary = value.toString(2).padStart(totalBits, '0');
        const extractedBits = binary.substring(totalBits - startBit - bitCount, totalBits - startBit);
        
        // Replace pattern with actual bits
        let result = pattern;
        let bitIndex = extractedBits.length - 1;
        
        for (let i = result.length - 1; i >= 0; i--) {
            if (result[i] === '1' || result[i] === '0') {
                if (bitIndex >= 0) {
                    result = result.substring(0, i) + extractedBits[bitIndex] + result.substring(i + 1);
                    bitIndex--;
                }
            }
        }
        
        return result;
    }

    formatBinaryDisplay(value, totalBits) {
        const binary = value.toString(2).padStart(totalBits, '0');
        return binary.replace(/(.{4})/g, '$1 ').trim();
    }

    calculateIEEE802154Length(buffer, offset, channel) {
        let currentOffset = offset;
        let hasSecurityHeader = false;
        
        // PHR
        currentOffset += this.getPHRLength(channel);
        
        // Frame Control + Sequence
        if (buffer.length >= currentOffset + 3) {
            const frameControl = buffer.readUInt16LE(currentOffset);
            currentOffset += 3; // FC + Seq
            
            // Check security
            hasSecurityHeader = ((frameControl >> 3) & 0x01) === 1;
            
            // Addressing
            const destAddrMode = (frameControl >> 10) & 0x03;
            const srcAddrMode = (frameControl >> 14) & 0x03;
            const panIdCompression = (frameControl >> 6) & 0x01;
            
            // Destination addressing
            if (destAddrMode !== 0) {
                currentOffset += 2; // Dest PAN ID
                currentOffset += destAddrMode === 2 ? 2 : 8; // Address
            }
            
            // Source addressing  
            if (srcAddrMode !== 0) {
                if (!panIdCompression) currentOffset += 2; // Src PAN ID
                currentOffset += srcAddrMode === 2 ? 2 : 8; // Address
            }
        }
        
        return { nextOffset: currentOffset, hasSecurityHeader };
    }

    getPHRLength(channel) {
        return (channel >= 11 && channel <= 26) ? 1 : 2;
    }

    getSecurityLevelDescription(level) {
        const descriptions = {
            0: 'None', 1: 'MIC-32', 2: 'MIC-64', 3: 'MIC-128',
            4: 'ENC', 5: 'Encrypted, 4 byte MIC', 6: 'ENC-MIC-64', 7: 'ENC-MIC-128'
        };
        return descriptions[level] || 'Reserved';
    }

    getKeyIdModeDescription(mode) {
        const descriptions = {
            0: 'No source', 1: 'Key Index', 2: '4-byte Key Source + Key Index', 3: '8-byte Key Source + Key Index'
        };
        return descriptions[mode] || 'Reserved';
    }

    getTrafficFlowDescription(tf) {
        const descriptions = { 0: 'elided', 1: 'ECN + DSCP', 2: 'ECN + Flow Label', 3: 'TC + FL' };
        return descriptions[tf] || 'Reserved';
    }

    getHopLimitDescription(hlim) {
        const descriptions = { 0: 'in-line', 1: 'limit 1', 2: 'limit 64', 3: 'limit 255' };
        return descriptions[hlim] || 'Reserved';
    }

    getAddressModeDescription(sam) {
        const descriptions = { 0: '128 bits or unspecified', 1: '64 bits', 2: '16 bits', 3: '0 bits' };
        return descriptions[sam] || 'Reserved';
    }

    getDestAddressModeDescription(dam, multicast) {
        if (multicast) {
            const descriptions = { 0: '128 or 48M bits', 1: '64 or 32M bits', 2: '32 or 16M bits', 3: '8 or 8M bits' };
            return descriptions[dam] || 'Reserved';
        } else {
            const descriptions = { 0: '128 or 48M bits', 1: '64 or 48M bits', 2: '16 or 32M bits', 3: '0 or 8M bits' };
            return descriptions[dam] || 'Reserved';
        }
    }
}

module.exports = PacketAnalyzer;

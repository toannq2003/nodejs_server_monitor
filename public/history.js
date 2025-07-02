class VirtualScrollHistory {
    constructor() {
        this.socket = io();
        this.currentPage = 1;
        this.pageSize = 50;
        this.totalRecords = 0;
        this.currentData = [];
        this.filteredData = [];
        this.currentFilters = {};
        this.lastId = null;
        this.firstId = null;
        this.isLoading = false;
        
        // Virtual scroll properties
        this.rowHeight = 45;
        this.visibleRows = 0;
        this.scrollTop = 0;
        this.startIndex = 0;
        this.endIndex = 0;
        this.paddingTop = 0;
        this.paddingBottom = 0;

        // Error code mappings
        this.txErrorCodes = {
            0: 'Success',
            1: 'Channel Busy',
            2: 'TX Blocked',
            3: 'TX Aborted',
            4: 'Scheduled TX Missed',
            5: 'No ACK',
            6: 'TXACK Aborted'
        };
        
        this.rxErrorCodes = {
            0: 'Success',
            1: 'CRC error',
            2: 'Format error',
            3: 'Aborted',
            4: 'Filtered',
            99: 'Unknown'
        };
        
        this.initializeElements();
        this.bindEvents();
        this.loadFilterOptions(); // Load dropdown options trước
        this.loadInitialData();
        
        const backBtn = document.getElementById('backToIndex');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
    }

    initializeElements() {
        // Filter elements
        this.typeFilter = document.getElementById('typeFilter');
        this.kitUniqueFilter = document.getElementById('kitUniqueFilter');
        this.comPortFilter = document.getElementById('comPortFilter');
        this.packetDataFilter = document.getElementById('packetDataFilter');
        this.applyFilterBtn = document.getElementById('applyFilter');
        this.clearFilterBtn = document.getElementById('clearFilter');
        
        // Pagination elements
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.pageInfo = document.getElementById('pageInfo');
        this.recordCount = document.getElementById('recordCount');
        
        // Virtual scroll elements
        this.scrollContainer = document.getElementById('virtualScrollContainer');
        this.scrollContent = document.getElementById('virtualScrollContent');
        this.scrollSpacer = document.getElementById('virtualScrollSpacer');
        this.tableBody = document.getElementById('tableBody');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        
        // Calculate visible rows
        this.visibleRows = Math.ceil(this.scrollContainer.clientHeight / this.rowHeight) + 5;
    }

    bindEvents() {
        // Filter events
        this.applyFilterBtn.addEventListener('click', () => this.applyFilters());
        this.clearFilterBtn.addEventListener('click', () => this.clearFilters());
        
        // Enter key cho packet data filter
        this.packetDataFilter.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.applyFilters();
        });
        
        // Pagination events
        this.prevBtn.addEventListener('click', () => this.loadPreviousPage());
        this.nextBtn.addEventListener('click', () => this.loadNextPage());
        
        // Virtual scroll events
        this.scrollContainer.addEventListener('scroll', () => this.handleScroll());
        
        // Socket events
        this.socket.on('historyData', (data) => this.handleHistoryData(data));
        this.socket.on('historyError', (error) => this.handleError(error));
        this.socket.on('filterOptions', (data) => this.handleFilterOptions(data));
        this.socket.on('filterOptionsError', (error) => console.error('Lỗi load filter options:', error));
        
        // Window resize
        window.addEventListener('resize', () => this.handleResize());
    }

    // Load các options cho dropdown filters
    loadFilterOptions() {
        this.socket.emit('requestFilterOptions');
    }

    handleFilterOptions(data) {
        if (data.success) {
            // Populate kitUnique dropdown
            this.populateDropdown(this.kitUniqueFilter, data.kitUniques, 'Tất cả Kit Unique');
            
            // Populate comPort dropdown
            this.populateDropdown(this.comPortFilter, data.comPorts, 'Tất cả COM Port');
        }
    }

    populateDropdown(selectElement, options, defaultText) {
        // Xóa các options cũ (trừ option đầu tiên)
        while (selectElement.children.length > 1) {
            selectElement.removeChild(selectElement.lastChild);
        }
        
        // Cập nhật text cho option đầu tiên
        selectElement.children[0].textContent = defaultText;
        
        // Thêm các options mới
        options.forEach(option => {
            if (option && option.trim() !== '') {
                const optionElement = document.createElement('option');
                optionElement.value = option;
                optionElement.textContent = option;
                selectElement.appendChild(optionElement);
            }
        });
    }

    applyFilters() {
        this.currentFilters = {
            type: this.typeFilter.value,
            kitUnique: this.kitUniqueFilter.value,
            comPort: this.comPortFilter.value,
            packetData: this.packetDataFilter.value.trim()
        };
        
        this.currentPage = 1;
        this.lastId = null;
        this.firstId = null;
        this.loadData();
    }

    clearFilters() {
        this.typeFilter.value = '';
        this.kitUniqueFilter.value = '';
        this.comPortFilter.value = '';
        this.packetDataFilter.value = '';
        
        this.currentFilters = {};
        this.currentPage = 1;
        this.lastId = null;
        this.firstId = null;
        this.loadData();
    }

    // Các methods khác giữ nguyên như cũ
    loadInitialData() {
        this.loadData();
    }

    loadData(direction = 'next') {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading();
        
        const requestData = {
            pageSize: this.pageSize,
            direction: direction,
            filters: this.currentFilters
        };
        
        if (direction === 'next' && this.lastId) {
            requestData.afterId = this.lastId;
        } else if (direction === 'prev' && this.firstId) {
            requestData.beforeId = this.firstId;
        }
        
        this.socket.emit('requestHistoryData', requestData);
    }

    loadNextPage() {
        if (this.lastId) {
            this.currentPage++;
            this.loadData('next');
        }
    }

    loadPreviousPage() {
        if (this.firstId && this.currentPage > 1) {
            this.currentPage--;
            this.loadData('prev');
        }
    }

    handleHistoryData(response) {
        this.isLoading = false;
        this.hideLoading();
        
        if (response.success) {
            this.currentData = response.data || [];
            this.totalRecords = response.totalRecords || 0;
            
            if (this.currentData.length > 0) {
                this.firstId = this.currentData[0].id;
                this.lastId = this.currentData[this.currentData.length - 1].id;
            }
            
            this.updatePaginationInfo();
            this.setupVirtualScroll();
            this.renderVisibleRows();
        } else {
            this.handleError(response.error || 'Lỗi không xác định');
        }
    }

    handleError(error) {
        this.isLoading = false;
        this.hideLoading();
        console.error('Lỗi:', error);
        alert('Có lỗi xảy ra: ' + error);
    }

    updatePaginationInfo() {
        this.recordCount.textContent = `Tổng: ${this.totalRecords} bản ghi`;
        this.pageInfo.textContent = `Trang ${this.currentPage}`;
        
        // Update button states
        this.prevBtn.disabled = this.currentPage <= 1;
        this.nextBtn.disabled = this.currentData.length < this.pageSize;
    }

    setupVirtualScroll() {
        const totalHeight = this.currentData.length * this.rowHeight;
        this.scrollSpacer.style.height = totalHeight + 'px';
        this.handleScroll();
    }

    handleScroll() {
        this.scrollTop = this.scrollContainer.scrollTop;
        this.startIndex = Math.floor(this.scrollTop / this.rowHeight);
        this.endIndex = Math.min(this.startIndex + this.visibleRows, this.currentData.length);
        
        this.paddingTop = this.startIndex * this.rowHeight;
        this.paddingBottom = (this.currentData.length - this.endIndex) * this.rowHeight;
        
        this.renderVisibleRows();
    }

    renderVisibleRows() {
        const visibleData = this.currentData.slice(this.startIndex, this.endIndex);
        
        this.tableBody.innerHTML = '';
        this.tableBody.style.transform = `translateY(${this.paddingTop}px)`;
        
        visibleData.forEach(row => {
            const tr = this.createTableRow(row);
            this.tableBody.appendChild(tr);
        });
    }

    getErrorDescription(errorCode, type) {
        const code = parseInt(errorCode);
        if (type === 'TX') {
            return this.txErrorCodes[code] || 'Unknown Error';
        } else if (type === 'RX') {
            return this.rxErrorCodes[code] || 'Unknown Error';
        }
        return 'Unknown Error';
    }

    createTableRow(data) {
        const tr = document.createElement('tr');
        
        // Format timestamp
        const timestamp = new Date(data.timestamp).toLocaleString('vi-VN');
        
        // Format error code with description
        const errorDescription = this.getErrorDescription(data.errorCode, data.type);
        const errorDisplay = `${data.errorCode} - ${errorDescription}`;
        
        tr.innerHTML = `
            <td><span class="type-badge type-${data.type.toLowerCase()}">${data.type}</span></td>
            <td>${data.packetLength || 0}</td>
            <td>${timestamp}</td>
            <td>${data.kitUnique || ''}</td>
            <td>${data.comPort || ''}</td>
            <td><span class="error-code error-${data.errorCode}" title="${errorDescription}">${errorDisplay}</span></td>
            <td><span class="bool-indicator bool-${data.isAck ? 'true' : 'false'}">${data.isAck ? 'Yes' : 'No'}</span></td>
            <td>${data.channel || ''}</td>
            <td>${data.type === 'RX' ? `<span class="bool-indicator bool-${data.crcPassed ? 'true' : 'false'}">${data.crcPassed ? 'Pass' : 'Fail'}</span>` : '-'}</td>
            <td>${data.type === 'RX' && data.rssi !== null ? data.rssi + ' dBm' : '-'}</td>
            <td>${data.type === 'RX' && data.lqi !== null ? data.lqi : '-'}</td>
            <td><div class="packet-data">${this.formatPacketData(data.packetData)}</div></td>
        `;

        // Add click handler for packet data
    const packetDataCell = tr.querySelector('.packet-data');
    packetDataCell.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.packetAnalysisModal) {
            console.log(`🖱️ Clicked packet ${data.id} for analysis`);
            window.packetAnalysisModal.show(data.id);
        } else {
            console.error('❌ Packet analysis modal not initialized');
        }
    });
        
        return tr;
    }

    formatPacketData(data) {
        if (!data) return '';
        
        // If it's hex data, format it nicely
        if (typeof data === 'string' && data.match(/^[0-9A-Fa-f\s]+$/)) {
            return data.replace(/(.{2})/g, '$1 ').trim().toUpperCase();
        }
        
        return data.toString().substring(0, 100) + (data.length > 100 ? '...' : '');
    }

    handleResize() {
        this.visibleRows = Math.ceil(this.scrollContainer.clientHeight / this.rowHeight) + 5;
        this.handleScroll();
    }

    showLoading() {
        this.loadingIndicator.classList.remove('hidden');
    }

    hideLoading() {
        this.loadingIndicator.classList.add('hidden');
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VirtualScrollHistory();
});

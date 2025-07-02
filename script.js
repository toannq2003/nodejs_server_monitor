const socket = io();

// Socket connection handling
socket.on("connect", () => {
  console.log("Connected to OpenThread Monitor");
  socket.emit("joinRoom", "indexRoom");

  setTimeout(() => {
    socket.emit("requestPacketData");
  }, 500);
});

// Socket event handlers
socket.on("packetData", (data) => {
  updatePacketTable(data);
});

socket.on("newPacketData", (data) => {
  addPacketToTable(data);
});

function getErrorCodeText(type, code) {
  const txMap = {
    0: "Success",
    1: "Channel Busy (CCA failed)",
    2: "TX Blocked",
    3: "TX Aborted",
    4: "Scheduled TX Missed",
    5: "No ACK (ACK timeout)",
    6: "TXACK Aborted",
  };
  const rxMap = {
    0: "Success",
    1: "CRC Error",
    2: "Format Error",
    3: "Aborted",
    4: "Filtered",
    99: "Unknown",
  };

  if (type === "TX") return txMap[code] || `Unknown TX Error (${code})`;
  if (type === "RX") return rxMap[code] || `Unknown RX Error (${code})`;
  return `Unknown (${code})`;
}

// Virtual Scroll Implementation
class VirtualScroll {
  constructor(container, options = {}) {
    this.container = container;
    this.content = container.querySelector(".virtual-scroll-content");
    this.viewport = container.querySelector(".virtual-scroll-viewport");

    this.rowHeight = options.rowHeight || 45;
    this.buffer = options.buffer || 5;
    this.data = [];
    this.filteredData = [];
    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.renderedRows = new Map();

    this.init();
  }

  init() {
    this.container.addEventListener("scroll", this.onScroll.bind(this));
    this.updateViewport();
  }

  // Thêm method này vào class VirtualScroll
addRealtimeData(newPacket) {
    console.log("Adding realtime packet:", newPacket);
    
    // Thêm vào đầu data array
    this.data.unshift(newPacket);

    // Limit data size for performance
  if (this.data.length > 1000) {
    //500
    this.data = this.data.slice(0, 500); //200
  }
    
    // Force clear tất cả rendered rows
    for (const [index, row] of this.renderedRows) {
        row.remove();
    }
    this.renderedRows.clear();
    
    // Apply filters và re-render
    this.applyFilters();
    
    // Auto scroll to top
    if (this.container.scrollTop < this.rowHeight * 3) {
        this.container.scrollTop = 0;
    }
}


  setData(data) {
    this.data = data;
    this.applyFilters();
  }

  applyFilters() {
    const typeFilter = document.getElementById("typeFilter").value;
    const kitFilter = document.getElementById("kitFilter").value;
    const comFilter = document.getElementById("comFilter").value;
    const dataFilter = document
      .getElementById("dataFilter")
      .value.toLowerCase();

    this.filteredData = this.data.filter((item) => {
      if (typeFilter && item.type !== typeFilter) return false;
      if (kitFilter && item.kitUnique !== kitFilter) return false;
      if (comFilter && item.comPort !== comFilter) return false;
      if (dataFilter && !item.packetData.toLowerCase().includes(dataFilter))
        return false;
      return true;
    });

    this.updateFilterStats();
    this.updateViewport();
    this.render();
    console.log(`Đã render`);
  }

  updateFilterStats() {
    const stats = document.getElementById("filterStats");
    stats.textContent = `Showing ${this.filteredData.length} of ${this.data.length} packets`;
  }

  updateViewport() {
    const totalHeight = this.filteredData.length * this.rowHeight;
    this.content.style.height = `${totalHeight}px`;

    const containerHeight = this.container.clientHeight - 45; // Minus header height
    const scrollTop = this.container.scrollTop;

    this.visibleStart = Math.max(
      0,
      Math.floor(scrollTop / this.rowHeight) - this.buffer
    );
    this.visibleEnd = Math.min(
      this.filteredData.length,
      Math.ceil((scrollTop + containerHeight) / this.rowHeight) + this.buffer
    );
  }

  onScroll() {
    this.updateViewport();
    this.render();
  }

  render() {
    // Remove rows that are no longer visible
    for (const [index, row] of this.renderedRows) {
      if (index < this.visibleStart || index >= this.visibleEnd) {
        row.remove();
        this.renderedRows.delete(index);
      }
    }

    // Add new visible rows
    for (let i = this.visibleStart; i < this.visibleEnd; i++) {
      if (!this.renderedRows.has(i) && this.filteredData[i]) {
        const row = this.createRow(this.filteredData[i], i);
        this.renderedRows.set(i, row);
        this.viewport.appendChild(row);
      }
    }
  }

  createRow(packet, index) {
    const row = document.createElement("div");
    row.className = "virtual-row";
    row.style.top = `${index * this.rowHeight}px`;
    row.style.height = `${this.rowHeight}px`;

    // Server timestamp
    const serverTimestamp = packet.timestamp
      ? new Date(packet.timestamp).toLocaleString("vi-VN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "N/A";

    // Kit timestamp - chuyển đổi từ Unix timestamp
    const kitTimestamp = packet.kitTimestamp
      ? new Date(packet.kitTimestamp * 1000).toLocaleString("vi-VN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : `${packet.kitTimestamp}`;

    const packetData = packet.packetData || "";
    const displayData =
      packetData.length > 37 ? packetData.substring(0, 37) + "..." : packetData;

    const errorCodeText = getErrorCodeText(packet.type, packet.errorCode || 0);
    const isSuccess = errorCodeText === "Success";
    if (packet.type === "RX") {
      console.log(
        `crc_passed ${packet.crc_passed}, crcPassed ${packet.crcPassed}`
      );
    }

    // CRC display cho RX packets
    const crcDisplay =
      packet.type === "RX" && packet.crcPassed !== null
        ? `<span class="badge bg-${packet.crcPassed ? "success" : "danger"}">
            <i class="fas fa-${packet.crcPassed ? "check" : "times"} me-1"></i>
            ${packet.crcPassed ? "PASS" : "FAIL"}
        </span>`
        : '<span class="text-muted">N/A</span>';

    row.innerHTML = `
        <div class="col" style="width: 8%;">
            <span class="badge bg-${
              packet.type === "TX" ? "success" : "info"
            } fs-6">
                <i class="fas fa-${
                  packet.type === "TX" ? "arrow-up" : "arrow-down"
                } me-1"></i>${packet.type}
            </span>
        </div>
        <div class="col" style="width: 15%;">
            <div class="time-column">
                <div class="server-time">
                    <span class="time-label">SRV:</span> ${serverTimestamp}
                </div>
                <div class="kit-time">
                    <span class="time-label">KIT:</span> ${kitTimestamp}
                </div>
            </div>
        </div>
        <div class="col" style="width: 7%;">
            <span class="badge bg-secondary">${packet.packetLength || 0}</span>
        </div>
        <div class="col" style="width: 10%;">
            <code class="text-primary">${(packet.kitUnique || "N/A").substring(
              0,
              16
            )}...</code>
        </div>
        <div class="col" style="width: 8%;">
            <span class="badge bg-dark">${packet.comPort || "N/A"}</span>
        </div>
        <div class="col" style="width: 8%;">
            <span class="badge bg-${
              isSuccess ? "success" : "danger"
            }">${errorCodeText}</span>
        </div>
        <div class="col" style="width: 5%;">
            <span class="badge bg-${packet.isAck ? "warning" : "primary"}">${
      packet.isAck ? "ACK" : "DATA"
    }</span>
        </div>
        <div class="col" style="width: 6%;">
            <span class="badge bg-info">${packet.channel || 0}</span>
        </div>
        <div class="col" style="width: 6%;">${crcDisplay}</div>
        <div class="col" style="width: 6%;">
            ${
              packet.type === "RX"
                ? `<span class="badge bg-info">${packet.rssi} dBm</span>`
                : '<span class="text-muted">N/A</span>'
            }
        </div>
        <div class="col" style="width: 5%;">
            ${
              packet.type === "RX"
                ? `<span class="badge bg-primary">${packet.lqi}</span>`
                : '<span class="text-muted">N/A</span>'
            }
        </div>
        <div class="col" style="width: 11%;">
            <a href="#" class="packet-data-link" data-packet='${JSON.stringify(
              packet
            ).replace(/'/g, "&apos;")}' title="Click to analyze packet">
                ${displayData}
            </a>
        </div>
    `;

    return row;
  }
}

// Initialize Virtual Scroll
let virtualScroll;
let allPacketData = [];

// Update packet table functions
function updatePacketTable(data) {
  console.log(`3456`);
  allPacketData = data;
  updateFilterOptions();
  if (virtualScroll) {
    virtualScroll.setData(data);
  }
}

function addPacketToTable(packet) {
  if (!packet) return;

  console.log(`1234`);

  //allPacketData.unshift(packet);


  updateFilterOptions();
  if (virtualScroll) {
    virtualScroll.addRealtimeData(packet);
  }
}

// Update filter options
function updateFilterOptions() {
  // Update Kit filter
  const kitFilter = document.getElementById("kitFilter");
  const uniqueKits = [
    ...new Set(allPacketData.map((p) => p.kitUnique).filter((k) => k)),
  ];
  kitFilter.innerHTML = '<option value="">All Kits</option>';
  uniqueKits.forEach((kit) => {
    const option = document.createElement("option");
    option.value = kit;
    option.textContent = kit.substring(0, 16) + "...";
    kitFilter.appendChild(option);
  });

  // Update COM filter
  const comFilter = document.getElementById("comFilter");
  const uniqueComs = [
    ...new Set(allPacketData.map((p) => p.comPort).filter((c) => c)),
  ];
  comFilter.innerHTML = '<option value="">All Ports</option>';
  uniqueComs.forEach((com) => {
    const option = document.createElement("option");
    option.value = com;
    option.textContent = com;
    comFilter.appendChild(option);
  });
}

// Initialize Virtual Scroll when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  const container = document.getElementById("virtualScrollContainer");
  if (container) {
    virtualScroll = new VirtualScroll(container, {
      rowHeight: 45,
      buffer: 10,
    });

    // Add filter event listeners
    document.getElementById("typeFilter").addEventListener("change", () => {
      console.log(`hello123`);
      if (virtualScroll) {
        console.log(`123456`);
        virtualScroll.applyFilters();
      }
    });

    document.getElementById("kitFilter").addEventListener("change", () => {
      if (virtualScroll) virtualScroll.applyFilters();
    });

    document.getElementById("comFilter").addEventListener("change", () => {
      if (virtualScroll) virtualScroll.applyFilters();
    });

    document.getElementById("dataFilter").addEventListener(
      "input",
      debounce(() => {
        if (virtualScroll) virtualScroll.applyFilters();
      }, 300)
    );
  }
});

// Debounce function for search input
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Update clear button functionality
document.getElementById("clearBtn").addEventListener("click", () => {
  allPacketData = [];
  if (virtualScroll) {
    virtualScroll.setData([]);
  }
  updateFilterOptions();
});

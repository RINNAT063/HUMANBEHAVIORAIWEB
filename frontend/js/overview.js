
const API_BASE = "http://localhost:18080";

const hoursSelect = document.getElementById("overviewHours");
const refreshButton = document.getElementById("overviewRefresh");
const notice = document.getElementById("overviewNotice");

let historyPoints = [];

// Dữ liệu tài nguyên riêng của video.
let videoResourcePoints = [];
let selectedOverviewVideoJobId = null;

// Dữ liệu so sánh nhiều lần phân tích video.
let videoComparisonRuns = [];


let ramRuns = [];
let requestVersion = 0;
let lineHoverIndex = -1;
let barHitboxes = [];
let chartStartTime = 0;
let chartEndTime = 0;

function text(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
}

function percent(value) {
    const number = Number(value);
    return Number.isFinite(number)
        ? `${number.toFixed(1)}%`
        : "--";
}

function updateResource(name, data, available) {
    const latest = available ? percent(data.latest) : "--";

    text(`${name}Latest`, latest);
    text(`${name}Recent`, latest);
    text(`${name}Average`, available ? percent(data.average) : "--");
    text(`${name}Peak`, available ? percent(data.peak) : "--");

    const ring = document.getElementById(`${name}Ring`);
    const value = available ? Number(data.latest) : 0;
    const clamped = Math.max(0, Math.min(100, value || 0));

    ring.style.setProperty("--value", `${clamped}%`);
}

function renderStats(data) {
    const available = Number(data.sample_count) > 0;

    updateResource("cpu", data.cpu, available);
    updateResource("ram", data.ram, available);
    updateResource("disk", data.disk, available);
}

function formatDuration(milliseconds) {
    const ms = Number(milliseconds);
    if (!Number.isFinite(ms) || ms <= 0) return "--";

    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return minutes
        ? `${minutes}:${String(seconds).padStart(2, "0")}`
        : `${totalSeconds}s`;
}

function formatTime(value) {
    if (!value) return "--";
    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "--"
        : date.toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit"
        });
}

function formatFullTime(value) {
    if (!value) return "Không có thời gian";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Không có thời gian";
    }

    return date.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
}

function statusBadge(status) {
    const labels = {
        pending: "Đang chờ",
        running: "Đang xử lý",
        completed: "Hoàn thành",
        failed: "Thất bại"
    };

    const element = document.createElement("span");
    const safeStatus = Object.hasOwn(labels, status)
        ? status
        : "failed";

    element.className = `overview-status ${safeStatus}`;
    element.textContent = labels[status] || "Không xác định";
    return element;
}

function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.appendChild(cell);
    return cell;
}

function videoCell(row, job) {
    const cell = document.createElement("td");
    const wrapper = document.createElement("div");
    const icon = document.createElement("span");
    const name = document.createElement("span");

    wrapper.className = "overview-video";
    icon.className = "overview-video-icon";
    icon.textContent = "▶";
    name.className = "overview-video-name";
    name.textContent = job.filename || "Video";

    wrapper.append(icon, name);
    cell.appendChild(wrapper);
    row.appendChild(cell);
}

function renderEmpty(tbody, colspan, message) {
    const row = document.createElement("tr");
    const cell = addCell(row, message);
    cell.colSpan = colspan;
    tbody.appendChild(row);
}

function renderQueue(queue, jobs) {
    text(
        "overviewQueueSummary",
        `Chờ: ${queue.pending ?? 0} · ` +
        `Chạy: ${queue.running ?? 0} · ` +
        `Xong: ${queue.completed ?? 0} · ` +
        `Lỗi: ${queue.failed ?? 0}`
    );

    const tbody = document.getElementById("overviewQueueBody");
    tbody.replaceChildren();

    const items = jobs.slice(0, 8);

    if (!items.length) {
        renderEmpty(tbody, 4, "Chưa có tác vụ trong khoảng thời gian này.");
        return;
    }

    items.forEach(job => {
        const row = document.createElement("tr");

        addCell(row, job.id ? job.id.slice(-9) : "--");
        videoCell(row, job);
        addCell(row, formatTime(job.queued_at));

        const cell = document.createElement("td");
        cell.appendChild(statusBadge(job.status));
        row.appendChild(cell);

        tbody.appendChild(row);
    });
}

function renderResults(jobs) {
    const tbody = document.getElementById("overviewResultsBody");
    tbody.replaceChildren();

    const items = jobs
        .filter(job =>
            job.status === "completed" || job.status === "failed"
        )
        .slice(0, 8);

    if (!items.length) {
        renderEmpty(tbody, 5, "Chưa có kết quả phân tích.");
        return;
    }

    items.forEach(job => {
        const row = document.createElement("tr");

        videoCell(row, job);
        addCell(row, formatDuration(job.duration_ms));

        const completed = job.status === "completed";
        addCell(row, completed ? (job.people_count ?? 0) : "--");
        addCell(row, completed ? (job.total_actions ?? 0) : "--");

        const cell = document.createElement("td");
        cell.appendChild(statusBadge(job.status));
        row.appendChild(cell);

        tbody.appendChild(row);
    });
}

function getChartTooltip(canvas) {
    const parent = canvas.closest(".overview-chart-card");

    let tooltip = parent.querySelector(
        ".overview-chart-tooltip"
    );

    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "overview-chart-tooltip";
        parent.appendChild(tooltip);
    }

    return tooltip;
}

function showChartTooltip(canvas, rows, mouseX, mouseY) {
    const tooltip = getChartTooltip(canvas);

    tooltip.replaceChildren();

    for (const row of rows) {
        const element = document.createElement("div");

        if (row.type === "title") {
            const title = document.createElement("strong");
            title.textContent = row.text;
            tooltip.appendChild(title);
            continue;
        }

        if (row.type === "time") {
            element.className = "tooltip-time";
            element.textContent = row.text;
            tooltip.appendChild(element);
            continue;
        }

        element.className = "tooltip-row";

        const label = document.createElement("span");
        const value = document.createElement("b");

        if (row.color) {
            const dot = document.createElement("i");
            dot.className = "tooltip-dot";
            dot.style.background = row.color;
            label.appendChild(dot);
        }

        label.appendChild(document.createTextNode(row.label));
        value.textContent = row.value;

        element.append(label, value);
        tooltip.appendChild(element);
    }

    const parent = canvas.closest(".overview-chart-card");
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    tooltip.classList.add("visible");

    const x = canvasRect.left - parentRect.left + mouseX;
    const y = canvasRect.top - parentRect.top + mouseY;

    const maxLeft = Math.max(
        8,
        parent.clientWidth - tooltip.offsetWidth - 8
    );

    tooltip.style.left =
        `${Math.max(8, Math.min(x + 15, maxLeft))}px`;

    tooltip.style.top =
        `${Math.max(8, y - tooltip.offsetHeight - 12)}px`;
}

function hideChartTooltip(canvas) {
    getChartTooltip(canvas).classList.remove("visible");
}

function prepareCanvas(id) {
    const canvas = document.getElementById(id);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return null;

    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const plot = {
        left: 41,
        right: width - 15,
        top: 18,
        bottom: height - 37
    };

    ctx.font = "11px Segoe UI";

    for (let tick = 0; tick <= 100; tick += 25) {
        const y = plot.bottom -
            tick / 100 * (plot.bottom - plot.top);

        ctx.strokeStyle = "#283047";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plot.left, y);
        ctx.lineTo(plot.right, y);
        ctx.stroke();

        ctx.fillStyle = "#8ca0c2";
        ctx.textAlign = "left";
        ctx.fillText(`${tick}%`, 5, y + 4);
    }

    return { ctx, plot, width, height };
}

function chartX(plot, index, length) {
    const ratio = length <= 1 ? 0.5 : index / (length - 1);
    return plot.left + ratio * (plot.right - plot.left);
}

function chartY(plot, value) {
    const number = Number(value);
    const safe = Number.isFinite(number)
        ? Math.max(0, Math.min(100, number))
        : 0;

    return plot.bottom -
        safe / 100 * (plot.bottom - plot.top);
}

function drawEmpty(ctx, width) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#9aaccc";
    ctx.fillText("Chưa có dữ liệu lịch sử", width / 2, 130);
}

function drawAxisLabels(ctx, plot, points) {
    if (!points.length) return;

    const first = points[0].time;
    const last = points[points.length - 1].time;

    ctx.fillStyle = "#8ca0c2";
    ctx.textAlign = "left";
    ctx.fillText(formatTime(first), plot.left, plot.bottom + 24);

    ctx.textAlign = "right";
    ctx.fillText(formatTime(last), plot.right, plot.bottom + 24);
}


function drawLineChart() {
    const setup = prepareCanvas("overviewLineChart");
    if (!setup) return;

    const { ctx, plot, width } = setup;

    if (!historyPoints.length) {
        drawEmpty(ctx, width);
        return;
    }

    const times = historyPoints.map(point =>
        new Date(point.time).getTime()
    );

    chartStartTime = Math.min(...times);
    chartEndTime = Math.max(...times);

    function getX(index) {
        if (chartStartTime === chartEndTime) {
            return (plot.left + plot.right) / 2;
        }

        return plot.left +
            (times[index] - chartStartTime) /
            (chartEndTime - chartStartTime) *
            (plot.right - plot.left);
    }

    function drawLine(field, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";

        historyPoints.forEach((point, index) => {
            const x = getX(index);
            const y = chartY(plot, point[field]);

            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });

        ctx.stroke();
    }

    drawLine("cpu", "#11c48b");
    drawLine("ram", "#3d89ff");

    // Duong doc va diem danh dau khi re chuot
    if (
        lineHoverIndex >= 0 &&
        lineHoverIndex < historyPoints.length
    ) {
        const point = historyPoints[lineHoverIndex];
        const x = getX(lineHoverIndex);

        ctx.save();

        ctx.strokeStyle = "#7183a7";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        ctx.moveTo(x, plot.top);
        ctx.lineTo(x, plot.bottom);
        ctx.stroke();

        ctx.setLineDash([]);

        [
            { key: "cpu", color: "#11c48b" },
            { key: "ram", color: "#3d89ff" }
        ].forEach(series => {
            const y = chartY(plot, point[series.key]);

            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = series.color;
            ctx.fill();

            ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
        });

        ctx.restore();
    }

    drawAxisLabels(ctx, plot, historyPoints);
}


function drawBarChart() {
    const setup = prepareCanvas("overviewBarChart");
    if (!setup) return;

    const { ctx, plot, width } = setup;

    barHitboxes = [];

    if (!ramRuns.length) {
        drawEmpty(ctx, width);
        return;
    }

    // API moi nhat truoc, bieu do ve cu nhat sang moi nhat
    const runs = [...ramRuns].reverse();

    const series = [
        { key: "before", label: "RAM trước", color: "#3d89ff" },
        { key: "peak", label: "RAM cao nhất", color: "#9765ed" },
        { key: "after", label: "RAM sau", color: "#11bd91" }
    ];

    const plotWidth = plot.right - plot.left;
    const groupWidth = plotWidth / runs.length;
    const barWidth = Math.min(18, groupWidth / 4.5);
    const visibleBarWidth = Math.max(2, barWidth - 2);

    runs.forEach((run, index) => {
        const center = plot.left +
            groupWidth * (index + 0.5);

        series.forEach((item, barIndex) => {
            const value = Number(run[item.key]);
            const x = center + (barIndex - 1) * barWidth
                - visibleBarWidth / 2;
            const y = chartY(plot, value);
            const height = plot.bottom - y;

            ctx.fillStyle = item.color;
            ctx.fillRect(x, y, visibleBarWidth, height);

            // Ghi lai vung click/hover cua tung cot
            barHitboxes.push({
                x,
                y,
                width: visibleBarWidth,
                height,
                run,
                label: item.label,
                value,
                color: item.color
            });
        });

        // Moi lan chay gan voi thoi diem bat dau
        ctx.fillStyle = "#9aadd0";
        ctx.textAlign = "center";
        ctx.font = "10px Segoe UI";

        const label = run.started_at
            ? formatTime(run.started_at)
            : `Lần ${index + 1}`;

        ctx.fillText(
            label,
            center,
            plot.bottom + 23
        );
    });

    ctx.textAlign = "left";
}

function handleLineHover(event) {
    const canvas = document.getElementById("overviewLineChart");

    if (!historyPoints.length) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const left = 41;
    const right = canvas.clientWidth - 15;
    const top = 18;
    const bottom = canvas.clientHeight - 37;

    if (x < left || x > right || y < top || y > bottom) {
        lineHoverIndex = -1;
        hideChartTooltip(canvas);
        drawLineChart();
        return;
    }

    const targetTime = chartStartTime +
        (x - left) / (right - left) *
        (chartEndTime - chartStartTime);

    let nearestIndex = 0;
    let smallestDistance = Infinity;

    historyPoints.forEach((point, index) => {
        const timestamp = new Date(point.time).getTime();
        const distance = Math.abs(timestamp - targetTime);

        if (distance < smallestDistance) {
            smallestDistance = distance;
            nearestIndex = index;
        }
    });

    lineHoverIndex = nearestIndex;

    const point = historyPoints[nearestIndex];

    drawLineChart();

    showChartTooltip(canvas, [
        {
            type: "title",
            text: "Tài nguyên hệ thống"
        },
        {
            type: "time",
            text: formatFullTime(point.time)
        },
        {
            label: "CPU",
            value: percent(point.cpu),
            color: "#11c48b"
        },
        {
            label: "RAM",
            value: percent(point.ram),
            color: "#3d89ff"
        }
    ], x, y);
}

function handleBarHover(event) {
    const canvas = document.getElementById("overviewBarChart");
    const rect = canvas.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const hovered = barHitboxes.find(bar =>
        x >= bar.x &&
        x <= bar.x + bar.width &&
        y >= bar.y &&
        y <= bar.y + bar.height
    );

    if (!hovered) {
        canvas.style.cursor = "default";
        hideChartTooltip(canvas);
        return;
    }

    canvas.style.cursor = "pointer";

    showChartTooltip(canvas, [
        {
            type: "title",
            text: hovered.run.filename || "Video không rõ tên"
        },
        {
            type: "time",
            text: "Bắt đầu: " +
                formatFullTime(hovered.run.started_at)
        },
        {
            label: hovered.label,
            value: percent(hovered.value),
            color: hovered.color
        },
        {
            label: "Số mẫu",
            value: String(hovered.run.sample_count ?? "--")
        }
    ], x, y);
}



function getVideoRamScale(points) {
    const values = points
        .map(sample => sample.video_ram_delta_mb)
        .filter(value =>
            value !== null &&
            value !== undefined &&
            Number.isFinite(Number(value))
        )
        .map(Number);

    if (!values.length) {
        return { min: -1, max: 1 };
    }

    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);

    if (min === max) {
        return {
            min: min - 1,
            max: max + 1
        };
    }

    return { min, max };
}

function drawVideoResourceLineChart() {
    const setup = prepareCanvas("videoResourceLineChart");
    if (!setup) return;

    const { ctx, plot, width } = setup;

    const points = videoResourcePoints.filter(sample =>
        sample.video_thread_cpu_percent !== null &&
        sample.video_thread_cpu_percent !== undefined &&
        Number.isFinite(Number(sample.video_thread_cpu_percent))
    );

    if (!points.length) {
        drawEmpty(ctx, width);
        return;
    }

    const maxCpu = Math.max(
        1,
        ...points.map(sample =>
            Number(sample.video_thread_cpu_percent)
        )
    );

    // Ghi đè nhãn trục CPU bằng giá trị thực tế.
    ctx.fillStyle = "#101626";
    ctx.fillRect(0, plot.top - 8, plot.left - 2,
                 plot.bottom - plot.top + 18);

    ctx.fillStyle = "#8ca0c2";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "left";

    for (let tick = 0; tick <= 4; tick++) {
        const value = maxCpu * tick / 4;
        const y = plot.bottom -
            tick / 4 * (plot.bottom - plot.top);

        ctx.fillText(`${value.toFixed(2)}%`, 3, y + 4);
    }

    const xAt = index =>
        chartX(plot, index, points.length);

    const yAt = value =>
        plot.bottom -
        Math.max(0, Number(value)) / maxCpu *
        (plot.bottom - plot.top);

    // Ghi chú đơn vị và giá trị CPU lớn nhất.
    ctx.fillStyle = "#9aaccc";
    ctx.textAlign = "right";
    ctx.font = "11px Segoe UI";
    ctx.fillText(
        `CPU tối đa: ${maxCpu.toFixed(2)}%`,
        plot.right,
        plot.top + 12
    );

    // Vẽ đường CPU thực tế.
    ctx.beginPath();
    ctx.strokeStyle = "#11c48b";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";

    points.forEach((sample, index) => {
        const x = xAt(index);
        const y = yAt(sample.video_thread_cpu_percent);

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    
    // Vẽ RAM backend bằng thang đo MB riêng.
    const ramScale = getVideoRamScale(points);

    const ramY = value =>
        plot.bottom -
        (Number(value) - ramScale.min) /
        (ramScale.max - ramScale.min) *
        (plot.bottom - plot.top);

    ctx.beginPath();
    ctx.strokeStyle = "#3d89ff";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";

    let hasRamPoint = false;
    let previousRamIndex = -2;

    points.forEach((sample, index) => {
        const value = sample.video_ram_delta_mb;

        if (
            value === null ||
            value === undefined ||
            !Number.isFinite(Number(value))
        ) {
            previousRamIndex = -2;
            return;
        }

        const x = xAt(index);
        const y = ramY(value);

        if (index !== previousRamIndex + 1) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        previousRamIndex = index;
        hasRamPoint = true;
    });

    if (hasRamPoint) {
        ctx.stroke();
    }

    // Hiển thị giới hạn thang RAM ở cạnh phải.
    ctx.fillStyle = "#3d89ff";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "right";

    ctx.fillText(
        `${ramScale.max.toFixed(1)} MB`,
        plot.right,
        plot.top - 5
    );

    ctx.fillText(
        `${ramScale.min.toFixed(1)} MB`,
        plot.right,
        plot.bottom - 5
    );

    // Đánh dấu từng mẫu đo.
    points.forEach((sample, index) => {
        ctx.beginPath();
        ctx.arc(
            xAt(index),
            yAt(sample.video_thread_cpu_percent),
            3,
            0,
            Math.PI * 2
        );
        ctx.fillStyle = "#11c48b";
        ctx.fill();
    });

    
    // Nhãn thời gian.
    ctx.fillStyle = "#9aaccc";
    ctx.font = "11px Segoe UI";

    ctx.textAlign = "left";
    ctx.fillText(
        new Date(points[0].sampled_at).toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }),
        plot.left,
        plot.bottom + 24
    );

    ctx.textAlign = "right";
    ctx.fillText(
        new Date(points[points.length - 1].sampled_at).toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }),
        plot.right,
        plot.bottom + 24
    );

}




function setupVideoComparisonTooltip() {
    const canvas = document.getElementById("videoResourceBarChart");
    const metricSelect = document.getElementById("videoComparisonMetric");

    if (!canvas || !metricSelect) return;

    canvas.title = "Rê chuột vào một cột để xem thông tin video";

    canvas.addEventListener("mousemove", event => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const runs = videoComparisonRuns;
        if (!runs.length) return;

        const plotLeft = 50;
        const plotRight = rect.width - 20;
        const plotTop = 36;
        const plotBottom = rect.height - 42;

        if (
            x < plotLeft || x > plotRight ||
            y < plotTop || y > plotBottom
        ) {
            canvas.title = "";
            return;
        }

        const groupWidth = (plotRight - plotLeft) / runs.length;
        const index = Math.floor((x - plotLeft) / groupWidth);

        const run = runs[index];
        if (!run) return;

        const metric = metricSelect.value;
        const value = run[metric];

        const units = {
            peakCpu: "%",
            peakRamIncrease: "MB",
            ioReadMb: "MB",
            ioWriteMb: "MB"
        };

        const formattedValue =
            value === null || value === undefined
                ? "N/A - Không có dữ liệu"
                : `${Number(value).toFixed(2)} ${units[metric]}`;

        canvas.title =
            `Lần ${index + 1}\n` +
            `Video: ${run.filename}\n` +
            `Mã tác vụ: ${run.id}\n` +
            `Giá trị: ${formattedValue}\n` +
            `Số mẫu đo: ${run.sampleCount}`;
    });
}

function drawVideoComparisonChart() {
    const canvas = document.getElementById("videoResourceBarChart");
    const setup = prepareCanvas("videoResourceBarChart");
    if (!setup) return;

    const { ctx, plot, width } = setup;

    const metricSelect = document.getElementById(
        "videoComparisonMetric"
    );

    const metric = metricSelect.value;

    const metricInfo = {
        peakCpu: { label: "CPU cao nhất", unit: "%", color: "#11c48b" },
        peakRamIncrease: { label: "RAM tăng cao nhất", unit: "MB", color: "#3d89ff" },
        ioReadMb: { label: "I/O đọc ghi nhận", unit: "MB", color: "#9765ed" },
        ioWriteMb: { label: "I/O ghi ghi nhận", unit: "MB", color: "#f5a623" }
    };

    const info = metricInfo[metric];

    
const runs = videoComparisonRuns;

const validRuns = runs.filter(run =>
    run[metric] !== null &&
    run[metric] !== undefined &&
    Number.isFinite(Number(run[metric]))
);


    if (!runs.length) {
        drawEmpty(ctx, width);
        return;
    }

    const maxValue = Math.max(
        1,
        ...validRuns.map(run => Number(run[metric]))
    );

    // Xóa nhãn phần trăm mặc định.
    ctx.fillStyle = "#101626";
    ctx.fillRect(
        0,
        plot.top - 8,
        plot.left - 2,
        plot.bottom - plot.top + 18
    );

    // Vẽ thang giá trị thực tế.
    ctx.fillStyle = "#8ca0c2";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "left";

    for (let tick = 0; tick <= 4; tick++) {
        const value = maxValue * tick / 4;
        const y = plot.bottom -
            tick / 4 * (plot.bottom - plot.top);

        ctx.fillText(
            `${value.toFixed(1)}`,
            3,
            y + 4
        );
    }

    const groupWidth = (plot.right - plot.left) / runs.length;
    const barWidth = Math.min(34, groupWidth * 0.55);

    runs.forEach((run, index) => {
        const value = Number(run[metric]);
        
        if (
            run[metric] === null ||
            run[metric] === undefined ||
            !Number.isFinite(value)
        ) {
            const centerX = plot.left +
                ((plot.right - plot.left) / runs.length) *
                (index + 0.5);

            ctx.fillStyle = "#9aadd0";
            ctx.font = "12px Segoe UI";
            ctx.textAlign = "center";
            ctx.fillText("N/A", centerX, plot.bottom - 12);
            ctx.fillText(
                `Lần ${index + 1}`,
                centerX,
                plot.bottom + 23
            );
            return;
        }


        const centerX = plot.left +
            groupWidth * (index + 0.5);

        const barHeight =
            value / maxValue *
            (plot.bottom - plot.top);

        const x = centerX - barWidth / 2;
        const y = plot.bottom - barHeight;

        ctx.fillStyle = info.color;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Ghi số thứ tự từng lần phân tích.
        ctx.fillStyle = "#9aadd0";
        ctx.font = "10px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText(
            `Lần ${index + 1}`,
            centerX,
            plot.bottom + 23
        );
    });

    // Hiển thị tên chỉ số và đơn vị.
    ctx.fillStyle = "#9aaccc";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "right";

    ctx.fillText(
        `${info.label} (${info.unit})`,
        plot.right,
        plot.top + 12
    );
}


function drawCharts() {
    drawLineChart();
    drawBarChart();
    drawVideoResourceLineChart();
    drawVideoComparisonChart();
}





async function loadVideoComparisonData(jobs) {
    // Lấy tối đa 8 tác vụ đã hoàn thành hoặc đang xử lý.
    const selectedJobs = jobs
        .filter(job =>
            job.id &&
            (job.status === "completed" || job.status === "running")
        )
        .slice(0, 8);

    if (!selectedJobs.length) {
        videoComparisonRuns = [];
        text("videoBarStatus", "Chưa có video để so sánh.");
        return;
    }

    const results = await Promise.allSettled(
        selectedJobs.map(async job => {
            const data = await fetchOverview(
                `/api/video-resources/${encodeURIComponent(job.id)}`
            );

            const samples = Array.isArray(data.samples)
                ? data.samples
                : [];

            const validNumbers = field =>
                samples
                    .map(sample => sample[field])
                    .filter(value =>
                        value !== null &&
                        value !== undefined &&
                        Number.isFinite(Number(value))
                    )
                    .map(Number);

            const cpu = validNumbers("video_thread_cpu_percent");
            const ram = validNumbers("video_ram_delta_mb");
            const ioRead = validNumbers("io_read_mb");
            const ioWrite = validNumbers("io_write_mb");

            if (!samples.length) return null;

            return {
                id: job.id,
                filename: job.filename || job.id,
                status: job.status,
                sampleCount: samples.length,
                peakCpu: cpu.length ? Math.max(...cpu) : null,
                peakRamIncrease: ram.length
                    ? Math.max(0, ...ram)
                    : null,
                ioReadMb: ioRead.length ? Math.max(...ioRead) : null,
                ioWriteMb: ioWrite.length ? Math.max(...ioWrite) : null
            };
        })
    );

    videoComparisonRuns = results
        .filter(result =>
            result.status === "fulfilled" && result.value !== null
        )
        .map(result => result.value);

    text(
        "videoBarStatus",
        videoComparisonRuns.length
            ? `Đã tải dữ liệu ${videoComparisonRuns.length} lần phân tích.`
            : "Chưa có mẫu tài nguyên để so sánh."
    );
}

async function loadVideoResourceData(jobs) {
    // Ưu tiên video đang chạy, sau đó đến video hoàn thành gần nhất.
    const selectedJob =
        jobs.find(job => job.status === "running") ||
        jobs.find(job => job.status === "completed");

    if (!selectedJob || !selectedJob.id) {
        selectedOverviewVideoJobId = null;
        videoResourcePoints = [];

        text("videoLineStatus", "Chưa có tác vụ video để hiển thị.");
        return;
    }

    const result = await fetchOverview(
        `/api/video-resources/${encodeURIComponent(selectedJob.id)}`
    );

    selectedOverviewVideoJobId = selectedJob.id;

    videoResourcePoints = Array.isArray(result.samples)
        ? result.samples
            .filter(sample =>
                Number.isFinite(
                    new Date(sample.sampled_at).getTime()
                )
            )
            .sort((a, b) =>
                new Date(a.sampled_at) - new Date(b.sampled_at)
            )
        : [];

    const videoName = selectedJob.filename || selectedJob.id;

    text(
        "videoLineStatus",
        videoResourcePoints.length
            ? `${videoName} · ${videoResourcePoints.length} mẫu đo`
            : `${videoName} · Chưa có mẫu tài nguyên`
    );
}

async function fetchOverview(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`${path}: HTTP ${response.status}`);
    }

    return response.json();
}

async function loadOverview() {
    const currentRequest = ++requestVersion;
    const hours = hoursSelect.value;

    refreshButton.disabled = true;
    notice.textContent = "Đang tải dữ liệu...";

    try {
        const [stats, chart, jobsResult, queue, ramResult] =
            await Promise.all([
                fetchOverview(`/api/overview/stats?hours=${hours}`),
                fetchOverview(`/api/overview/chart?hours=${hours}`),
                fetchOverview(`/api/overview/jobs?hours=${hours}`),
                fetchOverview("/api/overview/queue"),
                fetchOverview(`/api/overview/ram-runs?hours=${hours}`)
            ]);

        if (currentRequest !== requestVersion) return;

        renderStats(stats);

        const jobs = Array.isArray(jobsResult.jobs)
            ? jobsResult.jobs
            : [];

        renderQueue(queue, jobs);
        renderResults(jobs);
        
        // Tải dữ liệu tài nguyên của video được chọn.
        try {
            await loadVideoResourceData(jobs);
        } catch (videoError) {
            console.error("[VIDEO RESOURCE]", videoError);
            selectedOverviewVideoJobId = null;
            videoResourcePoints = [];

            text(
                "videoLineStatus",
                "Không tải được tài nguyên video."
            );
        }

        if (currentRequest !== requestVersion) return;
        
        // Lấy dữ liệu so sánh tài nguyên nhiều video.
        try {
            await loadVideoComparisonData(jobs);
        } catch (comparisonError) {
            console.error("[VIDEO COMPARISON]", comparisonError);
            videoComparisonRuns = [];

            text(
                "videoBarStatus",
                "Không tải được dữ liệu so sánh video."
            );
        }

        if (currentRequest !== requestVersion) return;



        historyPoints = Array.isArray(chart.points)
            ? chart.points.filter(point =>
                Number.isFinite(new Date(point.time).getTime())
              )
            : [];
        
        ramRuns = Array.isArray(ramResult.runs)
            ? ramResult.runs
            : [];
        
        lineHoverIndex = -1;
        hideChartTooltip(lineCanvas);
        hideChartTooltip(barCanvas);

        drawCharts();

        text("overviewApiStatus", "Đã kết nối");

        notice.textContent =
            `${stats.sample_count ?? 0} mẫu tài nguyên ` +
            `trong ${hours} giờ gần nhất.`;
    } catch (error) {
        if (currentRequest !== requestVersion) return;

        console.error("[RESOURCE OVERVIEW]", error);

        text("overviewApiStatus", "Mất kết nối");
        notice.textContent =
            "Không tải được dữ liệu. Kiểm tra server C++ và PostgreSQL.";
    } finally {
        if (currentRequest === requestVersion) {
            refreshButton.disabled = false;
        }
    }
}

hoursSelect.addEventListener("change", loadOverview);

const lineCanvas = document.getElementById("overviewLineChart");

lineCanvas.addEventListener("mousemove", handleLineHover);

lineCanvas.addEventListener("mouseleave", () => {
    lineHoverIndex = -1;
    hideChartTooltip(lineCanvas);
    drawLineChart();
});

const barCanvas = document.getElementById("overviewBarChart");

barCanvas.addEventListener("mousemove", handleBarHover);

barCanvas.addEventListener("mouseleave", () => {
    hideChartTooltip(barCanvas);
    barCanvas.style.cursor = "default";
});


const videoComparisonMetricSelect = document.getElementById(
    "videoComparisonMetric"
);

videoComparisonMetricSelect.addEventListener("change", () => {
    drawVideoComparisonChart();
});

setupVideoComparisonTooltip();
refreshButton.addEventListener("click", loadOverview);
window.addEventListener("resize", drawCharts);

loadOverview();

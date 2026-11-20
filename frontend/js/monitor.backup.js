const API_BASE = "http://localhost:18080";
let monitorRefreshing = false;

const gaugeState = {
    cpuGauge: { current: 0, target: 0, raf: 0 },
    ramGauge: { current: 0, target: 0, raf: 0 },
    diskGauge: { current: 0, target: 0, raf: 0 }
};

const countState = {
    pendingCount: 0,
    runningCount: 0,
    completedCount: 0,
    failedCount: 0
};

function easeOutCubic(t)
{
    return 1 - Math.pow(1 - t, 3);
}

function animateNumber(id, from, to, duration, formatter)
{
    const element = document.getElementById(id);
    if(!element)
    {
        return;
    }

    if(from === to)
    {
        element.textContent = formatter(to);
        return;
    }

    const start = performance.now();

    function frame(now)
    {
        const progress = Math.min(1, (now - start) / duration);
        const value = from + (to - from) * easeOutCubic(progress);
        element.textContent = formatter(value);
        if(progress < 1)
        {
            requestAnimationFrame(frame);
        }
    }

    requestAnimationFrame(frame);
}

function pulseElement(element)
{
    if(!element)
    {
        return;
    }

    element.classList.remove("value-pulse");
    void element.offsetWidth;
    element.classList.add("value-pulse");
}

function applyGaugeVisual(id, percent)
{
    const gauge = document.getElementById(id);
    if(!gauge)
    {
        return;
    }

    const safePercent = Math.max(0, Math.min(100, percent));
    gauge.style.setProperty("--gauge-value", `${safePercent * 1.8}deg`);
    gauge.classList.toggle("warning", safePercent >= 70);
    gauge.classList.toggle("danger", safePercent >= 90);
}

function updateGauge(id, percent, valueId, detailId, detailText)
{
    const state = gaugeState[id];
    if(!state)
    {
        return;
    }

    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const previous = state.current;
    state.target = safePercent;

    if(Math.abs(previous - safePercent) > 0.05)
    {
        pulseElement(document.getElementById(id)?.closest(".gauge-card"));
    }

    if(state.raf)
    {
        cancelAnimationFrame(state.raf);
    }

    const startValue = state.current;
    const delta = safePercent - startValue;
    const start = performance.now();
    const duration = 900;

    function frame(now)
    {
        const progress = Math.min(1, (now - start) / duration);
        const value = startValue + delta * easeOutCubic(progress);
        state.current = value;
        applyGaugeVisual(id, value);

        const valueEl = document.getElementById(valueId);
        if(valueEl)
        {
            valueEl.textContent = `${value.toFixed(1)}%`;
        }

        if(progress < 1)
        {
            state.raf = requestAnimationFrame(frame);
        }
        else
        {
            state.current = safePercent;
            state.raf = 0;
            applyGaugeVisual(id, safePercent);
            if(valueEl)
            {
                valueEl.textContent = `${safePercent.toFixed(1)}%`;
            }
        }
    }

    state.raf = requestAnimationFrame(frame);

    if(detailId && detailText !== undefined)
    {
        const detailEl = document.getElementById(detailId);
        if(detailEl && detailEl.textContent !== detailText)
        {
            detailEl.classList.add("detail-fade");
            detailEl.textContent = detailText;
            setTimeout(() => detailEl.classList.remove("detail-fade"), 400);
        }
    }
}

function updateCount(id, nextValue)
{
    const previous = countState[id] || 0;
    const value = Number(nextValue) || 0;
    countState[id] = value;

    animateNumber(id, previous, value, 600, n => String(Math.round(n)));

    if(previous !== value)
    {
        pulseElement(document.getElementById(id)?.closest("article"));
    }
}

function formatMegabytes(bytes)
{
    return `${(Number(bytes || 0) / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(milliseconds)
{
    if(!milliseconds)
    {
        return "—";
    }
    return `${(milliseconds / 1000).toFixed(1)} giây`;
}

function renderTasks(tasks)
{
    const body = document.getElementById("taskTableBody");
    if(!body)
    {
        return;
    }

    if(!tasks.length)
    {
        body.innerHTML =
            '<tr><td colspan="6" class="empty-state">Chưa có tác vụ.</td></tr>';
        return;
    }

    body.innerHTML = tasks.map((task, index) => `
        <tr class="task-row-enter" style="animation-delay:${index * 40}ms" title="${escapeMonitorHtml(task.error_message || "")}">
            <td><code>${escapeMonitorHtml(task.id)}</code></td>
            <td><span class="status-badge ${escapeMonitorHtml(task.status)}">${statusLabel(task.status)}</span></td>
            <td>${formatMegabytes(task.size_bytes)}</td>
            <td>${formatDuration(task.duration_ms)}</td>
            <td>${task.throughput_mbps ? `${Number(task.throughput_mbps).toFixed(2)} MB/s` : "—"}</td>
            <td>${escapeMonitorHtml(task.created_at || "—")}</td>
        </tr>
    `).join("");
}

function statusLabel(status)
{
    return {
        pending: "Đang chờ",
        running: "Đang chạy",
        completed: "Hoàn thành",
        failed: "Thất bại"
    }[status] || status;
}

function escapeMonitorHtml(value)
{
    const element = document.createElement("div");
    element.textContent = String(value);
    return element.innerHTML;
}

async function refreshMonitor()
{
    if(monitorRefreshing)
    {
        return;
    }
    monitorRefreshing = true;

    const connection = document.getElementById("monitorConnection");
    try
    {
        const [statsResponse, tasksResponse] = await Promise.all([
            fetch(`${API_BASE}/api/stats`),
            fetch(`${API_BASE}/api/tasks`)
        ]);

        if(!statsResponse.ok || !tasksResponse.ok)
        {
            throw new Error("Backend response failed");
        }

        const [stats, taskData] = await Promise.all([
            statsResponse.json(),
            tasksResponse.json()
        ]);

        const cpu = Number(stats.system.cpu_percent || 0);
        const ram = Number(stats.system.ram_percent || 0);
        const disk = Number(stats.system.disk_percent || 0);

        updateGauge(
            "cpuGauge",
            cpu,
            "cpuValue"
        );
        updateGauge(
            "ramGauge",
            ram,
            "ramValue",
            "ramDetail",
            `${stats.system.ram_used_mb} / ${stats.system.ram_total_mb} MB`
        );
        updateGauge(
            "diskGauge",
            disk,
            "diskValue",
            "diskDetail",
            `${stats.system.disk_used_gb} / ${stats.system.disk_total_gb} GB`
        );

        const counts = stats.tasks;
        updateCount("pendingCount", counts.pending);
        updateCount("runningCount", counts.running);
        updateCount("completedCount", counts.completed);
        updateCount("failedCount", counts.failed);
        renderTasks(taskData.tasks || []);

        connection.textContent = "Đang hoạt động";
        connection.className = "connection-badge online";
    }
    catch(error)
    {
        connection.textContent = "Mất kết nối";
        connection.className = "connection-badge offline";
    }
    finally
    {
        monitorRefreshing = false;
    }
}

let monitorTimer = null;

function startMonitor()
{
    if(monitorTimer)
    {
        return;
    }

    refreshMonitor();
    monitorTimer = setInterval(refreshMonitor, 2000);
}

function stopMonitor()
{
    if(monitorTimer)
    {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }
}

function openMonitorPopup()
{
    const modal = document.getElementById("monitorModal");
    if(!modal)
    {
        return;
    }

    modal.classList.remove("hidden");
    document.body.classList.add("monitor-popup-open");
    startMonitor();
}

function closeMonitorPopup()
{
    const modal = document.getElementById("monitorModal");
    if(!modal)
    {
        return;
    }

    modal.classList.add("hidden");
    document.body.classList.remove("monitor-popup-open");

    if(!document.body.classList.contains("monitor-page"))
    {
        stopMonitor();
    }
}

function bindMonitorPopup()
{
    const openBtn = document.getElementById("openMonitorBtn");
    const closeBtn = document.getElementById("closeMonitorBtn");
    const backdrop = document.getElementById("monitorModalBackdrop");

    if(openBtn)
    {
        openBtn.addEventListener("click", openMonitorPopup);
    }

    if(closeBtn)
    {
        closeBtn.addEventListener("click", closeMonitorPopup);
    }

    if(backdrop)
    {
        backdrop.addEventListener("click", closeMonitorPopup);
    }

    document.addEventListener("keydown", event =>
    {
        if(event.key === "Escape")
        {
            closeMonitorPopup();
        }
    });
}


bindMonitorPopup();

if(
    document.body.classList.contains("monitor-page") ||
    document.body.classList.contains("page")
)
{
    startMonitor();
}


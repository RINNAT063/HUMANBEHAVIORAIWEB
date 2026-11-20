const API_BASE = "http://localhost:18080";
let monitorRefreshing = false;

let selectedVideoJobId = null;

let selectedVideoTaskStatus = null;

let videoResourceRefreshing = false;



const gaugeState = {
    cpuGauge: { current: 0, target: 0, raf: 0 },
    ramGauge: { current: 0, target: 0, raf: 0 },
    diskGauge: { current: 0, target: 0, raf: 0 },

    // Đồng hồ CPU của tác vụ video
    videoCpuGauge: { current: 0, target: 0, raf: 0 }
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


function chooseAutomaticVideoTask(tasks)
{
    if (!Array.isArray(tasks) || tasks.length === 0)
    {
        return null;
    }

    // Ưu tiên tác vụ đang phân tích.
    const runningTask = tasks.find(task =>
        task.status === "running"
    );

    if (runningTask)
    {
        return runningTask.id;
    }

    // Nếu không có tác vụ đang chạy,
    // ưu tiên tác vụ hoàn thành gần nhất.
    const completedTasks = tasks.filter(task =>
        task.status === "completed"
    );

    if (completedTasks.length === 0)
    {
        return null;
    }

    completedTasks.sort((a, b) =>
        Date.parse(b.created_at || 0) -
        Date.parse(a.created_at || 0)
    );

    return completedTasks[0].id;
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


async function refreshVideoResources()
{
    if (!selectedVideoJobId || videoResourceRefreshing)
    {
        return;
    }

    videoResourceRefreshing = true;

    const jobId = selectedVideoJobId;
    const statusElement = document.getElementById("videoResourceStatus");

    try
    {
        const response = await fetch(
            `${API_BASE}/api/video-resources/${encodeURIComponent(jobId)}`
        );

        if (!response.ok)
        {
            throw new Error("Cannot load video resources");
        }

        const data = await response.json();

        // Không hiển thị dữ liệu cũ nếu người dùng đã đổi video.
        if (selectedVideoJobId !== jobId)
        {
            return;
        }

        const samples = Array.isArray(data.samples)
            ? data.samples
            : [];

        const cpuSamples = samples.filter(sample =>
            sample.video_thread_cpu_percent !== null &&
            sample.video_thread_cpu_percent !== undefined &&
            Number.isFinite(Number(sample.video_thread_cpu_percent))
        );

        if (cpuSamples.length === 0)
        {
            if (statusElement)
            {
                statusElement.textContent =
                    `Tác vụ ${jobId}: chưa có dữ liệu CPU video.`;
            }
            return;
        }

        
        // CPU mới nhất khi đang chạy, CPU cao nhất khi hoàn thành.
        const latestSample = cpuSamples[cpuSamples.length - 1];

        const latestCpu = Number(
            latestSample.video_thread_cpu_percent
        );

        const peakCpu = Math.max(
            ...cpuSamples.map(sample =>
                Number(sample.video_thread_cpu_percent)
            )
        );

        const cpuPercent = selectedVideoTaskStatus === "completed"
            ? peakCpu
            : latestCpu;


        updateGauge(
            "videoCpuGauge",
            cpuPercent,
            "videoCpuValue"
        );
        
        // Hiển thị nhãn phù hợp với trạng thái tác vụ.
        const cpuDetailElement = document.getElementById("videoCpuDetail");

        if (cpuDetailElement)
        {
            cpuDetailElement.textContent =
                selectedVideoTaskStatus === "completed"
                    ? "CPU cao nhất"
                    : selectedVideoTaskStatus === "running"
                        ? "CPU hiện tại"
                        : "CPU xử lý cục bộ";
        }

        
        // RAM: mức thay đổi bộ nhớ backend khi phân tích video.
        const ramSamples = samples.filter(sample =>
            sample.video_ram_delta_mb !== null &&
            sample.video_ram_delta_mb !== undefined &&
            Number.isFinite(Number(sample.video_ram_delta_mb))
        );

        if (ramSamples.length > 0)
        {
            const latestRam = Number(
                ramSamples[ramSamples.length - 1].video_ram_delta_mb
            );

            const ramValueElement = document.getElementById("videoRamValue");
            const ramDetailElement = document.getElementById("videoRamDetail");

            if (ramValueElement)
            {
                ramValueElement.textContent =
                    `${latestRam >= 0 ? "+" : ""}${latestRam.toFixed(2)} MB`;
            }

            if (ramDetailElement)
            {
                ramDetailElement.textContent =
                    "Thay đổi RAM backend";
            }
        }


        if (statusElement)
        {
            statusElement.textContent =
                `Đang xem tài nguyên tác vụ: ${jobId}`;
        }
    }
    catch (error)
    {
        if (selectedVideoJobId === jobId && statusElement)
        {
            statusElement.textContent =
                "Không thể tải dữ liệu tài nguyên video.";
        }

        console.error("[VIDEO RESOURCES]", error);
    }
    finally
    {
        videoResourceRefreshing = false;
    }
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
        
       
        // Tự động chọn tác vụ video cần giám sát.

        // Tự động chọn tác vụ video cần giám sát.
        const automaticJobId = chooseAutomaticVideoTask(
            taskData.tasks || []
        );

        const videoTasks = taskData.tasks || [];

        const selectedTask = videoTasks.find(task =>
            task.id === automaticJobId
        );

        // Cập nhật mã và trạng thái trước khi gọi API.
        selectedVideoJobId = automaticJobId;
        selectedVideoTaskStatus = selectedTask
            ? selectedTask.status
            : null;

        if (automaticJobId)
        {
            await refreshVideoResources();
        }



        if (selectedTask && selectedTask.size_bytes != null)
        {
            const diskValue = document.getElementById("videoDiskValue");
            const diskDetail = document.getElementById("videoDiskDetail");

            if (diskValue)
            {
                diskValue.textContent =
                    formatMegabytes(selectedTask.size_bytes);
            }

            if (diskDetail)
            {
                diskDetail.textContent =
                    "Dung lượng tệp video tải lên";
            }
        }




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


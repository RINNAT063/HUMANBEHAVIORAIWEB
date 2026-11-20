const menuBtn =
    document.getElementById("menuBtn");

const sidebar =
    document.getElementById("sidebar");

const overlay =
    document.getElementById("overlay");

if(menuBtn && sidebar && overlay)
{
    menuBtn.addEventListener(
        "click",
        () =>
        {
            sidebar.classList.toggle(
                "active"
            );

            overlay.classList.toggle(
                "active"
            );
        }
    );


    overlay.addEventListener(
        "click",
        closeSidebar
    );


    function closeSidebar()
    {
        sidebar.classList.remove(
            "active"
        );

        overlay.classList.remove(
            "active"
        );
    }
}

overlay.addEventListener(
    "click",
    () =>
    {
        sidebar.classList.remove(
            "active"
        );

        overlay.classList.remove(
            "active"
        );
    }
);

const observer =
new IntersectionObserver(entries =>
{
    entries.forEach(entry =>
    {
        if(entry.isIntersecting)
        {
            entry.target.classList.add("show");
        }
    });
});

const processToggle =
    document.getElementById(
        "processToggle"
    );

const processContent =
    document.getElementById(
        "processContent"
    );

const processArrow =
    document.getElementById(
        "processArrow"
    );


if(
    processToggle &&
    processContent
)
{
    processToggle.addEventListener(
        "click",
        () =>
        {
            processContent.classList.toggle(
                "closed"
            );

            processArrow.classList.toggle(
                "rotate"
            );
        }
    );
}

const videoInput =
    document.getElementById(
        "videoFile"
    );

const fileInfo =
    document.getElementById(
        "fileInfo"
    );

const videoPreview =
    document.getElementById(
        "videoPreview"
    );

const previewContainer =
    document.getElementById(
        "videoPreviewContainer"
    );


if(videoInput)
{
    videoInput.addEventListener(
        "change",
        function()
        {
            const file =
                videoInput.files[0];


            if(!file)
            {
                return;
            }

            const sizeMB =
                (
                    file.size /
                    1024 /
                    1024
                ).toFixed(2);


            fileInfo.innerHTML =
                `
                    <strong>
                        Video đã chọn:
                    </strong>

                    ${file.name}

                    &nbsp; | &nbsp;

                    ${sizeMB} MB
                `;


            fileInfo.style.display =
                "block";

            const videoURL =
                URL.createObjectURL(
                    file
                );


            videoPreview.src =
                videoURL;


            previewContainer.classList.remove(
                "hidden"
            );
        }
    );
}

document
.querySelectorAll(
".card,.skeleton-section"
)
.forEach(el =>
{
    observer.observe(el);
});

const cards =
document.querySelectorAll(
".resource-card"
);

cards.forEach(card =>
{
    observer.observe(card);
});

const centerTextPlugin =
{
    id: "centerText",

    beforeDraw(chart)
    {
        const { ctx } = chart;

        const centerX =
            chart.getDatasetMeta(0)
            .data[0].x;

        const centerY =
            chart.getDatasetMeta(0)
            .data[0].y;

        ctx.save();

        ctx.font =
            "bold 20px Arial";

        ctx.fillStyle =
            "#FFFFFF";

        ctx.textAlign =
            "center";

        ctx.textBaseline =
            "middle";

        ctx.fillText(
            chart.options.centerText,
            centerX,
            centerY
        );

        ctx.restore();
    }
};

function formatSeconds(seconds)
{
    const minutes =
        Math.floor(seconds / 60);

    const secs =
        seconds % 60;

    return (
        String(minutes)
            .padStart(2, "0")
        +
        ":"
        +
        String(secs)
            .padStart(2, "0")
    );
}

async function uploadVideo()
{
    const file =
        document.getElementById(
            "videoFile"
        ).files[0];

    if(!file)
    {
        alert(
            "Vui lòng chọn video trước."
        );

        return;
    }

    const loading =
        document.getElementById(
            "loading"
        );

    const result =
        document.getElementById(
            "result"
        );
    const loadingText =
        loading.querySelector("p");

    loading.classList.remove(
        "hidden"
    );

    result.innerHTML = "";

    const formData =
        new FormData();

    formData.append(
        "video",
        file
    );

    try
    {
        const response =
            await fetch(
                "http://localhost:18080/upload",
                {
                    method: "POST",
                    body: formData
                }
            );

        const data =
            await response.json();

        if(!response.ok || !data.task_id)
        {
            throw new Error(
                data.message || "Không thể tạo tác vụ."
            );
        }

        const task =
            await waitForTask(
                data.task_id,
                loadingText
            );

        if(task.status === "failed")
        {
            throw new Error(
                task.error_message ||
                "Phân tích video thất bại."
            );
        }

        const aiData =
            JSON.parse(
                task.analysis
            );

        renderResult(
            aiData
        );
    }
    catch(error)
    {
        result.innerHTML =
        `
            <div class="error-box">
                ${escapeHtml(
                    error.message ||
                    "Không thể kết nối Backend."
                )}
            </div>
        `;
    }
    finally
    {
        loading.classList.add(
            "hidden"
        );

        loadingText.textContent =
            "Đang tải và phân tích video...";
    }
}

async function waitForTask(
    taskId,
    loadingText
)
{
    const maxAttempts = 300;

    for(let attempt = 0; attempt < maxAttempts; attempt++)
    {
        const response =
            await fetch(
                `http://localhost:18080/api/tasks/${encodeURIComponent(taskId)}`
            );

        const task = await response.json();
        if(!response.ok)
        {
            throw new Error(
                task.message ||
                "Không thể đọc trạng thái tác vụ."
            );
        }

        loadingText.textContent =
            task.status === "pending"
                ? "Tác vụ đang chờ trong hàng đợi..."
                : "AI đang phân tích video...";

        if(
            task.status === "completed" ||
            task.status === "failed"
        )
        {
            return task;
        }

        await new Promise(resolve =>
            setTimeout(resolve, 2000)
        );
    }

    throw new Error("Tác vụ xử lý quá thời gian chờ.");
}

function escapeHtml(value)
{
    const element = document.createElement("div");
    element.textContent = String(value);
    return element.innerHTML;
}

function timeToSeconds(time)
{
    const [m, s] = time.split(":").map(Number);
    return m * 60 + s;
}

function renderResult(aiData)
{
    const result =
        document.getElementById(
            "result"
        );

    let html =
    `
        <div class="summary-card">

            <h2>
                Tóm tắt video
            </h2>

            <p>
                ${aiData.summary}
            </p>

        </div>
    `;

    const chartConfigs = [];

    aiData.people.forEach(person =>
    {
        const labels = [];
        const chartData = [];
        const colors = [];

        person.actions.forEach((action, index) =>
        {
            labels.push(
                `${action.start} - ${action.end}`
            );

            chartData.push(
                timeToSeconds(action.end)
                -
                timeToSeconds(action.start)
            );

            let color;
            
            if(action.type === "absent")
            {
                color = "#DADDE2";
            }
            else
            {
                color = 
                    `hsl(${index * 47},65%,75%)`;
            }

            colors.push(color);

            action.chartColor = color;
        });

        const totalDuration =
            chartData.reduce(
            (sum, value) =>
                sum + value,
            0
            );

        chartConfigs.push({
            personId: person.id,
            labels,
            chartData,
            colors,
            totalDuration,
            endTimes:
                person.actions.map(
                    action => action.end
                )
        });

        html +=
        `
        <div class="person-card">

            <h2>
                Người ${person.id}
            </h2>

            <table class="person-table">

                <tr>
                    <th>Thời gian</th>
                    <td>${person.time}</td>
                </tr>

                <tr>
                    <th>Giới tính</th>
                    <td>${person.gender}</td>
                </tr>

                <tr>
                    <th>Độ tuổi</th>
                    <td>${person.age}</td>
                </tr>

                <tr>
                    <th>Đặc điểm</th>
                    <td>${person.appearance}</td>
                </tr>

                <tr>
                    <th>Hành vi</th>
                    <td>${person.behavior}</td>
                </tr>

            </table>

            <div class="action-layout">
                
                <div class="action-chart-wrapper">
                    <canvas
                        id="chart-person-${person.id}">
                    </canvas>
                </div>
                
                <div class="action-detail">

                    <h3>
                        Danh sách hành động
                    </h3>

                    <ul>
        `;

        person.actions.forEach(action =>
        {
            html +=
            `
                        <li>
                            <span
                                class="action-color"
                                style="
                                    background:
                                    ${action.chartColor}
                            ">
                            </span>

                            <b>
                                ${action.start}
                                -
                                ${action.end}
                            </b>
                            :
                            ${action.description}
                        </li>
            `;
        });

        html +=
        `
                    </ul>

                </div>
            
            </div>

            <h3>
                Tương tác
            </h3>

            <p>
                ${
                    person.interaction_people
                    .length > 0
                    ?
                    person.interaction_people.join(", ")
                    :
                    "Không có"
                }
            </p>

            <p>
                ${person.interaction_detail}
            </p>

        </div>
        `;
    });

    result.innerHTML =
    html;

    chartConfigs.forEach(chart =>
    {
        const canvas =
            document.getElementById(
                `chart-person-${chart.personId}`
            );

        if(!canvas)
        {
            return;
        }

        new Chart(canvas,
        {
            plugins:
            [
                centerTextPlugin
            ],

            type: "doughnut",

            data:
            {
                labels: chart.labels,

                datasets:
                [{
                    data: chart.chartData,
                    backgroundColor:
                        chart.colors
                }]
            },

            options:
            {
                centerText:
                    formatSeconds(
                        chart.totalDuration
                    ),

                cutout: "68%",

                responsive: true,

                plugins:
                {
                    legend:
                    {
                        display: false
                    }
                }
            }
        });

    });
}

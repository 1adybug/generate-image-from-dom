"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const md5_1 = __importDefault(require("md5"));
const path_1 = __importDefault(require("path"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const dotenv_1 = __importDefault(require("dotenv"));
const { parsed } = dotenv_1.default.config();
if (!parsed) {
    throw new Error("请先配置 .env 文件");
}
const { SERVER_PORT, CHROME_PATH } = parsed;
if (!SERVER_PORT) {
    throw new Error("请在 .env 文件中配置服务器端口");
}
if (!CHROME_PATH) {
    throw new Error("请在 .env 文件中配置 Chrome 的启动路径");
}
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
const fileTypes = ["js", "css", "fonts", "images"];
function getErrorReponse(message) {
    return {
        success: false,
        data: null,
        message
    };
}
function getDataResponse(data) {
    return {
        success: true,
        data,
        message: null
    };
}
function getSendData(response) {
    return function sendData(data) {
        response.send(getDataResponse(data));
    };
}
function getSendError(response) {
    return function sendError(message) {
        response.send(getErrorReponse(message));
    };
}
fileTypes.forEach(type => {
    app.get(`/${type}/:fileName`, async (request, response) => {
        const { fileName } = request.params;
        if (typeof fileName !== "string")
            return response.send("no such file");
        const dir = path_1.default.join(path_1.default.resolve("./"), "static", type);
        const filePath = path_1.default.join(dir, fileName);
        if (!filePath.startsWith(dir))
            return response.send("no such file");
        response.sendFile(filePath);
    });
});
app.get("/text-to-image", async (request, response) => {
    response.sendFile(path_1.default.join(path_1.default.resolve("./"), "static", "html", "text-to-image.html"));
});
let browser;
let page;
async function startChrome() {
    await browser?.close();
    browser = await puppeteer_1.default.launch({
        executablePath: CHROME_PATH
    });
    page = await browser.newPage();
    await page.goto(`http://localhost:${SERVER_PORT}/text-to-image`);
}
async function generate(config, second) {
    try {
        const { dom, selector } = config;
        const finger = (0, md5_1.default)(JSON.stringify({ dom, selector }));
        const dir = fs_1.default.readdirSync(path_1.default.resolve("./static/images"));
        const oldImageName = dir.find(it => it.startsWith(finger) && it.endsWith(".png"));
        if (oldImageName) {
            const strList = oldImageName.split("-");
            const width = Number(strList[1]);
            const height = Number(strList[2].slice(0, -4));
            return { path: `/images/${oldImageName}`, width, height };
        }
        const info = (await page.evaluate((dom, selector) => {
            document.body.innerHTML = dom;
            return new Promise(resolve => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        const ele = document.querySelector(selector);
                        if (!(ele instanceof HTMLElement))
                            return resolve(null);
                        const { offsetWidth: width, offsetHeight: height } = ele;
                        toPng(ele)
                            .then(base64 => {
                            resolve({
                                base64,
                                width,
                                height
                            });
                        })
                            .catch(err => {
                            resolve(null);
                        });
                    });
                });
            });
        }, dom, selector));
        if (!info)
            return null;
        const { base64, width, height } = info;
        const imageName = `${finger}-${width}-${height}.png`;
        const imagePath = path_1.default.join(path_1.default.resolve("./"), "static", "images", imageName);
        fs_1.default.writeFileSync(imagePath, base64.replace("data:image/png;base64,", ""), "base64");
        return { path: `/images/${imageName}`, width, height };
    }
    catch (error) {
        console.log("生成图片错误：");
        console.log(error);
        if (second)
            return null;
        await startChrome();
        return await generate(config, true);
    }
}
app.listen(SERVER_PORT, async () => {
    await startChrome();
    app.post("/generate-image", async (request, response) => {
        const sendData = getSendData(response);
        const sendError = getSendError(response);
        const { dom, selector } = request.body;
        if (typeof dom !== "string")
            return sendError("wrong dom string");
        if (typeof selector !== "string")
            return sendError("wrong selector");
        const result = await generate({ dom, selector });
        if (!result)
            return sendError("生成图片失败");
        sendData(result);
    });
    app.post("/batch-generate-image", async (request, response) => {
        const sendData = getSendData(response);
        const sendError = getSendError(response);
        const list = request.body.list;
        if (!Array.isArray(list))
            return sendError("无效的 list 参数");
        const data = [];
        for (const config of list) {
            const { id, dom, selector } = config;
            if (typeof id !== "string" || typeof dom !== "string" || typeof selector !== "string")
                continue;
            const result = await generate({ dom, selector });
            if (!result)
                continue;
            data.push({ id, ...result });
        }
        sendData(data);
    });
});

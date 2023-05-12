import cors from "cors"
import express from "express"
import { Response } from "express-serve-static-core"
import fs from "fs"
import md5 from "md5"
import path from "path"
import puppeteer, { Browser, Page } from "puppeteer"
import dotenv from "dotenv"

const { parsed } = dotenv.config()

if (!parsed) {
    throw new Error("请先配置 .env 文件")
}

const { SERVER_PORT, CHROME_PATH } = parsed

if (!SERVER_PORT) {
    throw new Error("请在 .env 文件中配置服务器端口")
}

if (!CHROME_PATH) {
    throw new Error("请在 .env 文件中配置 Chrome 的启动路径")
}

const app = express()

app.use(express.json())

app.use(cors())

const fileTypes = ["js", "css", "fonts", "images"]

interface ResponseData<T> {
    success: true
    data: T
    message: null
}

interface ResponseError {
    success: false
    data: null
    message: string
}

function getErrorReponse(message: string): ResponseError {
    return {
        success: false,
        data: null,
        message
    }
}

function getDataResponse<T>(data: T): ResponseData<T> {
    return {
        success: true,
        data,
        message: null
    }
}

function getSendData(response: Response<any, Record<string, any>, number>) {
    return function sendData<T>(data: T) {
        response.send(getDataResponse(data))
    }
}

function getSendError(response: Response<any, Record<string, any>, number>) {
    return function sendError(message: string) {
        response.send(getErrorReponse(message))
    }
}

fileTypes.forEach(type => {
    app.get(`/${type}/:fileName`, async (request, response) => {
        const { fileName } = request.params
        if (typeof fileName !== "string") return response.send("no such file")
        const dir = path.join(path.resolve("./"), "static", type)
        const filePath = path.join(dir, fileName)
        if (!filePath.startsWith(dir)) return response.send("no such file")
        response.sendFile(filePath)
    })
})

app.get("/text-to-image", async (request, response) => {
    response.sendFile(path.join(path.resolve("./"), "static", "html", "text-to-image.html"))
})

interface ImageInfo {
    base64: string
    width: number
    height: number
}

interface GenerateImageConfig {
    dom: string
    selector: string
}

interface BatchGenerateImageConfig extends GenerateImageConfig {
    id: string
}

interface GenerateImageResult {
    path: string
    width: number
    height: number
}

interface BatchGenerateImageResult extends GenerateImageResult {
    id: string
}

let browser: Browser
let page: Page

async function startChrome() {
    await browser?.close()
    browser = await puppeteer.launch({
        executablePath: CHROME_PATH
    })
    page = await browser.newPage()
    await page.goto(`http://localhost:${SERVER_PORT}/text-to-image`)
}

async function generate(config: GenerateImageConfig, second?: boolean): Promise<GenerateImageResult | null> {
    try {
        const { dom, selector } = config
        const finger = md5(JSON.stringify({ dom, selector }))
        const dir = fs.readdirSync(path.resolve("./static/images"))
        const oldImageName = dir.find(it => it.startsWith(finger) && it.endsWith(".png"))
        if (oldImageName) {
            const strList = oldImageName.split("-")
            const width = Number(strList[1])
            const height = Number(strList[2].slice(0, -4))
            return { path: `/images/${oldImageName}`, width, height }
        }
        const info = (await page.evaluate(
            (dom: string, selector: string) => {
                document.body.innerHTML = dom
                return new Promise(resolve => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const ele = document.querySelector(selector)
                            if (!(ele instanceof HTMLElement)) return resolve(null)
                            const { offsetWidth: width, offsetHeight: height } = ele
                            toPng(ele as HTMLElement)
                                .then(base64 => {
                                    resolve({
                                        base64,
                                        width,
                                        height
                                    })
                                })
                                .catch(err => {
                                    resolve(null)
                                })
                        })
                    })
                })
            },
            dom,
            selector
        )) as ImageInfo | null

        if (!info) return null

        const { base64, width, height } = info

        const imageName = `${finger}-${width}-${height}.png`

        const imagePath = path.join(path.resolve("./"), "static", "images", imageName)

        fs.writeFileSync(imagePath, base64.replace("data:image/png;base64,", ""), "base64")

        return { path: `/images/${imageName}`, width, height }
    } catch (error) {
        console.log("生成图片错误：")
        console.log(error)
        if (second) return null
        await startChrome()
        return await generate(config, true)
    }
}

app.listen(SERVER_PORT, async () => {

    await startChrome()

    app.post("/generate-image", async (request, response) => {
        const sendData = getSendData(response)
        const sendError = getSendError(response)
        const { dom, selector } = request.body

        if (typeof dom !== "string") return sendError("wrong dom string")

        if (typeof selector !== "string") return sendError("wrong selector")

        const result = await generate({ dom, selector })

        if (!result) return sendError("生成图片失败")

        sendData(result)
    })

    app.post("/batch-generate-image", async (request, response) => {
        const sendData = getSendData(response)
        const sendError = getSendError(response)
        const list = request.body.list as BatchGenerateImageConfig[]
        if (!Array.isArray(list)) return sendError("无效的 list 参数")
        const data: BatchGenerateImageResult[] = []
        for (const config of list) {
            const { id, dom, selector } = config
            if (typeof id !== "string" || typeof dom !== "string" || typeof selector !== "string") continue
            const result = await generate({ dom, selector })
            if (!result) continue
            data.push({ id, ...result })
        }
        sendData(data)
    })
})

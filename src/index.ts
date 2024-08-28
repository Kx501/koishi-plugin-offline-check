import { Context, Logger, Schema, h, sleep } from "koishi";

export const name = "offline-check";

export const log = new Logger('offline-check');

export interface Config {
    checkbot: {
        platform: string;
        selfId: string;
    };
    messagebot: {
        platform: string;
        selfId: string;
        channelId: string;
    };
    notifyInterval: number;
    maxRestartAttempts: number;
}

export const Config: Schema<Config> = Schema.object({
    checkbot: Schema.object({
        platform: Schema.string().required().description("机器人平台"),
        selfId: Schema.string().required().description("机器人 SelfId"),
    }).description("受检机器人"),
    messagebot: Schema.object({
        platform: Schema.string().required().description("机器人平台"),
        selfId: Schema.string().required().description("机器人 SelfId"),
        channelId: Schema.string().required().description("发送消息的频道"),
    }).description("检查机器人"),
    notifyInterval: Schema.number().default(60000).description("通知间隔时间，单位为毫秒"),
    maxRestartAttempts: Schema.number().default(3).description("最大重启尝试次数"),
});

export function apply(ctx: Context, config: Config) {
    const { checkbot, messagebot, notifyInterval, maxRestartAttempts } = config;
    const { platform: cp, selfId: cs } = checkbot;
    const { platform: mp, selfId: ms, channelId: mc } = messagebot;

    let lastNotifyTime = 0;
    let pendingNotifications: Map<string, string> = new Map();
    let restartAttempts = 0;

    const sendNotifications = async () => {
        const msgCol = h("figure");
        for (const notification of pendingNotifications.values()) {
            msgCol.children.push(h("message", null, notification));
        }
        try {
            await ctx.bots[`${mp}:${ms}`].sendMessage(mc, msgCol);
        } catch (error) {
            log.error(`Failed to send notification: ${error.message}`);
        }
        pendingNotifications.clear();
        lastNotifyTime = Date.now();
    };

    ctx.on("login-updated", async ({ bot }) => {
        if (cs === bot.selfId && cp === bot.platform) {
            try {
                // 确保 bot.user 已初始化
                for (let i = 0; bot.user.name === undefined; i++) {
                    if (i > 3) {
                        ctx.bots[`${mp}:${ms}`].sendMessage(mc, '机器人未登录，请检查配置');
                        return;
                    }
                    await sleep(5000);
                }

                const statusText = [
                    "当前下线",
                    "当前上线",
                    "成功连接至服务器",
                    "连接断开",
                    "正在重连中，请等待重连...",
                    "未知状态"
                ];

                const notification = `${bot.platform} 平台的 ${bot.user.name || "未知"} 机器人${statusText[bot.status]}`;
                pendingNotifications.set(bot.user.name || bot.selfId, notification);

                if (notifyInterval === 0) {
                    await ctx.bots[`${mp}:${ms}`].sendMessage(mc, notification);
                    pendingNotifications.clear();
                } else if (Date.now() - lastNotifyTime > notifyInterval) {
                    await sendNotifications();
                }

                if (bot.status === 3 || bot.status === 0) {
                    await sleep(10000);
                    if (bot.status === 3 || bot.status === 0) {
                        if (restartAttempts < maxRestartAttempts) {
                            restartAttempts++;
                            ctx.bots[`${mp}:${ms}`].sendMessage(mc, `手动尝试重启...`);
                            ctx.bots[`${cp}:${cs}`].start();
                        } else {
                            ctx.bots[`${mp}:${ms}`].sendMessage(mc, `重连尝试失败已达到最大次数，机器人已关闭，请手动重启`);
                            ctx.bots[`${cp}:${cs}`].stop();
                            restartAttempts = 0; // 重置重启尝试次数
                        }
                    }
                }

                if (bot.status === 4) {
                    await sleep(60000);
                    if (bot.status === 4) {
                        ctx.bots[`${mp}:${ms}`].sendMessage(mc, `机器人重连失败，尝试重启`);
                        ctx.bots[`${cp}:${cs}`].stop();
                        await sleep(3000);
                        ctx.bots[`${cp}:${cs}`].start();
                        restartAttempts = 0; // 重置重启尝试次数
                    }
                }
            } catch (error) {
                log.error(`Error handling login-updated event: ${error.message}`);
            }
        }
    });
}
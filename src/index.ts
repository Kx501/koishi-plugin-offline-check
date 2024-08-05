import { Context, Schema } from "koishi";

export const name = "offline-check";

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
    maxReconnectAttempts: number;
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
    maxReconnectAttempts: Schema.number().default(3).description("最大重连尝试次数"),
});

export async function apply(ctx: Context, config: Config) {
    const { checkbot, messagebot, notifyInterval, maxReconnectAttempts } = config;
    const { platform: cp, selfId: cs } = checkbot;
    const { platform: mp, selfId: ms, channelId: mc } = messagebot;

    let lastNotifyTime = 0;
    let pendingNotifications: Map<string, string> = new Map();
    let reconnectAttempts: Map<string, number> = new Map();

    ctx.on("login-updated", async ({ bot }) => {
        const currentTime = Date.now();

        if (cs === bot.selfId && cp === bot.platform) {
            const statusText = [
                "当前离线",
                "当前在线",
                "已连接至服务器",
                "已断开连接，请检查网络状态",
                "正在重连中，请等待重连或检查网络状态",
                "状态未知",
            ];

            pendingNotifications.set(bot.user.name, `${bot.platform} 平台的 ${bot.user.name} 机器人${statusText[bot.status]}`);

            if (currentTime - lastNotifyTime > notifyInterval) {
                for (const notification of pendingNotifications.values()) {
                    ctx.bots[`${mp}:${ms}`].sendMessage(mc, notification);
                }
                pendingNotifications.clear();
                lastNotifyTime = currentTime;
            }

            if (bot.status == 3 || bot.status == 0) {
                await ctx.sleep(5000);
                if (bot.status == 3 || bot.status == 0) {
                    const attemptKey = `${cp}:${cs}`;
                    const attempts = reconnectAttempts.get(attemptKey) || 0;

                    if (attempts < maxReconnectAttempts) {
                        ctx.bots[`${mp}:${ms}`].sendMessage(mc, `正在尝试重连`);
                        ctx.bots[`${cp}:${cs}`].start();
                        reconnectAttempts.set(attemptKey, attempts + 1);
                    } else {
                        ctx.bots[`${mp}:${ms}`].sendMessage(mc, `重连尝试失败已达到最大次数，停止重连`);
                    }
                }
            }

            if (bot.status == 4) {
                await ctx.sleep(60000);
                if (bot.status == 4) {
                    ctx.bots[`${mp}:${ms}`].sendMessage(mc, `机器人重连失败，正在重启`);
                    ctx.bots[`${cp}:${cs}`].stop();
                    await ctx.sleep(3000);
                    ctx.bots[`${cp}:${cs}`].start();
                    reconnectAttempts.set(`${cp}:${cs}`, 0);
                }
            }
        }
    });
}

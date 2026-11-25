# sdk/host

这里是房间插件宿主（`room-plugin@1`）的服务端文件，从 AiATT 平台原样复制，只改了一处：宿主读存储的那一行改成了 `./store-shim`（内存实现，不需要数据库）。开发者工具（`packages/plugin-sdk`）用它在本地跑你的插件。**不要在这里改代码**：改动请先开 issue，维护者在平台一侧修改，下一次同步会覆盖这里。

These are the server files of the room plugin host (`room-plugin@1`), copied verbatim from the AiATT platform with one change: the line where the host loads the platform store now loads `./store-shim` (an in-memory stand-in, no database needed). The developer tools in `packages/plugin-sdk` use it to run your plugin locally. **Do not edit these files**: open an issue first; maintainers change them on the platform side and the next sync overwrites this directory.

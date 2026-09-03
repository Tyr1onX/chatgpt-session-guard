# Field Debug 安装

1. 解压 `ChatGPT-Session-Guard-Field-Debug.zip`。
2. Chrome 打开“扩展程序”并开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的目录。
4. 正常使用 ChatGPT，不需要专门测试或打开 DevTools。
5. 如果滚动旧历史的问题再次出现，打开 Session Guard。
6. 点击“导出现场诊断”，把生成的 ZIP 发给 GPT。

如果当前已经安装旧的 unpacked 版本，可以把新包解压到你自己的扩展目录后，在扩展程序页面点击“重新加载”。不要覆盖不确定来源的目录。

Field Debug 只在本机被动记录脱敏诊断，不上传数据，也不保存聊天正文、Prompt、回答、标题、文件或图片内容。

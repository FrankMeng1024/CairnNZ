# Web Search Results
Generated: 2026-06-23 10:21:13
Total queries: 6
Successful: 6/6

---

## Query 1: fog of war signed distance field SDF shader Unity
**Latency**: 2.77s

**unity-shader-SignedDistanceField(SDF)_unity sdf-CSDN博客** (2019-06-21)
unity-shader-SignedDistanceField(SDF) 前篇 Signed Distance Field - https://zhuanlan.zhihu.com/p/26217154unity画个多边形如何用shader抗锯齿? - https://www.zhihu.com/question/267382412Unity Anti-aliasing shader (SDF) - https://www.jianshu.com/p/2171db34ce58Signed Distance Field : Signed,正负号,Distance,点到点的距离,Field,区域,其实就是 判断一个点是否在一个区域内 抗锯齿方面的使用 原理 利用的是 uv 值做的 SDF,多边形中心点,uv值为(0,0),边上的点uv值为(1,0)｡这时候,从中心到边缘,uv的x值边缘为1,非边缘在0~1之间｡这时候只要利用 uv.x在x和y方向上的偏导数来取出 几个像素做下边缘 alpha 模糊即可｡ 应为利用了 alpha 做混合, 所以渲染队列必须在 Transparent 参考测试工程中的 SignedDistanceField02.shader 模型 uv 分布 所以可以考虑用多一套 uv 去存储这个值, 这里我直接用第一套 效果 左下角的为 unity 内置的 quad, 正常的 方形uv分布. shader 代码 需要注意的是 fwidth 是dx11 的函数, 
Source: https://blog.csdn.net/yangxuan0261/article/details/93202604

**Unity TextMeshPro学习_unity textpro-CSDN博客** (2025-11-20)
 5. SDF渲染( Signed Distance Field,有向距离场): Unity默认使用位图渲染字体,即根据字体 信息 生成对应字符的位图信息: 使用这种渲染方式,当字体放大后,锯齿感严重,渲染效果不理想; TextMeshPro默认使用SDF渲染: SDF字体贴图中记录的不是字符位图颜色信息,而是该像素点到字符边缘的距离;在字符中间,距离值最大,然后从里往外逐渐变小;渲染时根据当前距离值来决定显示的颜色值;
Source: https://blog.csdn.net/qilin598866753/article/details/140423158

**Tech-Artist 学习笔记:Signed Distance Field 8SSEDT 算法 - 知乎** (2022-08-23)
Signed Distance Field (有向距离场) 技术在如今的图形渲染项目中有着广泛的运用,例如Ray Marching､风格化卡通渲染的人物面部光照等等, 如果我们想在线性的时间内,通过一张二值化的黑白图,生成一张 SDF 图,那么目前8SSEDT(8-points Signed Sequential Euclidean Distance Transform) 算法是比较流行的解法｡ 8SSEDT 的核心就是递推算法——把复杂问题拆解成连续的简单问题｡SDF 图记录的是当前像素到物体的距离,距离是连续的,也就是说我们可以通过临近像素的距离推到出当前像素的距离｡ 核心思路: 假设有一张黑白原图,观察其 9 个点的局部,其每个点的平方距离如下 Raw Data Sqr Dist[0][0][0] [ 2][ 1][ 1][0][1][1] [ 1][ 0][ 0][0][1][1] [ 1][ 0][-1] 首先遍历一遍黑白原图,][0][0][∞][0][0] [0]0][0] [0][∞][∞] 推导过程则是一个像素分别和周边的 8 个像素进行比较 [#8][#7][#6][#1][ 0][#5][#2][#3][#4] unity 图像的的UV 坐标的是从左下到右上的,针对第一组向外的网格数据,首先我们可以从左往右､从下到上推,对比当前像素到左边､左下,下边像素的距离｡然后再从右往左､从下到上推,对比当前像素到右下､右边像素的距离 ^ x]x] 
Source: https://zhuanlan.zhihu.com/p/518292475

**unity signed distance fields 生成,图片转sdf贴图,unit shader与compute shader 对比_知乎** (2021-07-16)
输入 1024*1024 spread 256 unit shader 耗时:1.3582911秒 compute shader 耗时:1.1612073秒 unit shader 渲染 compute shader 渲染 左:unit shader 输出,右:compute shader 输出 SdfGenerate.cs using System ; using System.Collections ; using System.Collections.Generic ; using System.IO ; using UnityEditor ; using UnityEngine ; public class Watch { public DateTime beforeDT = System . DateTime . Now ; public DateT ElapsedMilliseconds => afterDT . Subtract ( beforeDT ). TotalMilliseconds ; } [CustomEditor(typeof(SdfGenerate))] public class SdfGenerateInsp : Editor { public override void OnInspectorGUI () { base . DrawDefaultInspector (); f Blend SrcAlpha OneMinusSrcAlpha 
Source: https://zhuanlan.zhihu.com/p/390255113

**有向距离场(SDF)在Shader中的简单应用-CSDN博客** (2024-12-08)
SDF, 全称Signed Distance Filed,就是有符号的距离区域 看下简单的例子,一个圆型区域 那么我们定义一个距离场函数: float sdfCircle(vec2 tex, vec2 center, float dis) { return -length(vec2(tex - center)) + dis;那么说了这么多,这个sdf的应用有哪些的,下面我们看一些应用: eg1:在一个画布上画一个抗锯齿的圆,下图是在shadertoy上画的一个圆,代码非常简单, 代码如下: float sdfCircle(vec2 tex, vec2 center, float dis) { return -length(vec2(tex - center)) + dis; } void mainImage(out vec4 fragColor, in vec2 fragCoord ) { // Normalized pixel coordinates (from 0 to 1) vec2 uv = fragCoord; vec2 center = 0.5 * iResolution.xy; vec3 background_color = vec3(0.3, 0.3, 0.3); vec3 circle_color = vec3(0.6, 0.6, 0.); vec3 edge_color = vec3(1., 1., 1.); float edge_width 
Source: https://blog.csdn.net/qq_41841073/article/details/121718928

**Unity中使用SignedDistanceField(一)矢量图 - 知乎** (2021-01-29)
核心思想就是需要确定像素点位于内部还是外部,这个内部可以理解为字体的轮廓内部,外部则是字体轮廓外部(内部可用0表示,外部可用无穷表示,当然也可以相反);接下来就是分两步计算,第一步计算内部到外部的距离(内部无穷,外部为0),记做outside,第二步是计算外部到内部的距离(外部无穷,内部为0),记做inside,最后outside-inside,得到的就是内部的值为正,外部的值为负,就是一个标准的有向距离场｡ 下面是Unity中的代码实现,参考: public void LoadFromTexture(Texture2D texture) { Color[] texpixels = texture.GetPixeims * m_y_dims]; for (int i = 0; i < m_pixels.Length; i++) { if (texpixels[i].r > 0.5f) m_pixels[i].distance = -99999f; else m_pixels[i].distance = 99999f; } } void BuildSweepGrids(out float[] outside_grid, out float[] inside_grid) { out64 SDF 64*64 效果图 64*64的效果图,明显有像素压缩导致的精度丢失问题 679*6
Source: https://zhuanlan.zhihu.com/p/347584370

**【UnityShader】 有向距离场(SDF)(13) - 知乎** (2023-06-16)
 先看函数时,很难得知该函数具体表示的是什么样的一个结构,但是通过该函数可以轻易的判断点在这个圆环的内外位置关系如何,这就是隐式几何的优点 此外,还有“距离函数”: 距离函数:对于任何一个几何,不描述它的表面,而去描述空间中点到各个几何物体表面的最近距离,这个距离可以是正or负(Signed Distance 有向距离),后对于各个几何物体的距离函数进行运算,就可以得到blend融合后的距离
Source: https://zhuanlan.zhihu.com/p/633589464

**Unity-TextMeshPro字体使用_unity字体包-CSDN博客** (2025-04-30)
TextMeshPro 的原理是基于 Mesh 渲染的,它使用了一种叫做 Signed Distance Field(简称 SDF)的技术,可以在运行时动态生成文本的 Mesh,从而实现更高质量的 文本渲染 效果｡ SDF 技术是一种将二维平面上的图像转换为三维空间中的距离场的技术｡在SDF 中,每个像素点都包含了一个距离值,表示该像素点距离图像的边缘有多远｡
Source: https://blog.csdn.net/qq_42603590/article/details/103279626

**TextMeshPro原理与实战:SDF字体渲染技术详解-CSDN博客** (2026-05-24)
基于SDF(Signed Distance Field,有向距离场)技术的全新文本渲染系统 ｡它的核心价值不在“能显示中文字体”,而在于彻底重构了“文字如何从设计稿变成屏幕像素”的整个链条｡传统Text组件依赖位图字体(Bitmap Font)或动态字体(Dynamic Font),前者缩放失真､后者性能开销大且抗锯齿质量差;
Source: https://blog.csdn.net/weixin_33749131/article/details/93251496

**shader学习记录——SDF绘制图形_sdf图怎么制作-CSDN博客** (2022-12-08)
参考链接 Shader "Unlit/SDFShader" { Properties { _MainTex ("Texture", 2D) = "white" {} } SubShader { Tags { "RenderType"="Opaque" } LOD 100 Pass { CGPROGRAM #pragma vertex vert #pragma fragment frag // make fog work #pragma multi_compile_fog #include "UnityCG.cginc" struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; }; struct v2f { float2 uv : TEXCOORD0; UNITY_FOG_COORDS(1) float4 vertex : SV_POSITION; }; sampler2D _MainTex; float4 _MainTex_ST; float sdCircle(float2 p,float r) { return length(p)-r; //到圆表面的距离 } float sdBox(float2 p,float2 b) { float2 d = abs(p) - b; return length(max(d,0))+min(max(d.x,d.y),0); } float 
Source: https://blog.csdn.net/chillxiaohan/article/details/128232708


**Sources**:
- [unity-shader-SignedDistanceField(SDF)_unity sdf-CSDN博客](https://blog.csdn.net/yangxuan0261/article/details/93202604)
- [Unity TextMeshPro学习_unity textpro-CSDN博客](https://blog.csdn.net/qilin598866753/article/details/140423158)
- [Tech-Artist 学习笔记:Signed Distance Field 8SSEDT 算法 - 知乎](https://zhuanlan.zhihu.com/p/518292475)
- [unity signed distance fields 生成,图片转sdf贴图,unit shader与compute shader 对比_知乎](https://zhuanlan.zhihu.com/p/390255113)
- [有向距离场(SDF)在Shader中的简单应用-CSDN博客](https://blog.csdn.net/qq_41841073/article/details/121718928)
- [Unity中使用SignedDistanceField(一)矢量图 - 知乎](https://zhuanlan.zhihu.com/p/347584370)
- [【UnityShader】 有向距离场(SDF)(13) - 知乎](https://zhuanlan.zhihu.com/p/633589464)
- [Unity-TextMeshPro字体使用_unity字体包-CSDN博客](https://blog.csdn.net/qq_42603590/article/details/103279626)
- [TextMeshPro原理与实战:SDF字体渲染技术详解-CSDN博客](https://blog.csdn.net/weixin_33749131/article/details/93251496)
- [shader学习记录——SDF绘制图形_sdf图怎么制作-CSDN博客](https://blog.csdn.net/chillxiaohan/article/details/128232708)

---

## Query 2: tile based fog of war reveal algorithm 2D
**Latency**: 3.32s

**latex 算法,算法包 algorithm, algorithm2e-CSDN博客** (2023-09-13)
排版为 if 条件then 肯定语句end \While {条件日循环语句} 排版为 while 条件do 循环语句end 使用 \renewcommand{\algorithmcfname}{算法} 命令修改算法显示｡ 举例: \begin{algorithm} \caption{Simulation-optimization heuristic}\label{algorithm} \KwData{current period $t$, initial inventory $I_{t-1}$, initial capital $B_{t-1}$, demand samples} \KwResult{Optimal order quantity $Q^{\ast}_{t}$} $r\leftarrow t$\; $\Delta B^{\ast}\leftarrow -\infty$\; \While{$\Delta B\leq \Delta B^{\ast}$ and $r\leq T$}{$Q\leftarrow\arg\max_{Q\geq 0}\Delta B^{Q}_{t,r}
Source: https://blog.csdn.net/robert_chen1988/article/details/71512914

**Algorithm(算法)_pang9998的博客-CSDN博客** (2026-06-09)
关闭 搜索 AI 搜索 登录 登录后您可以享受以下权益: 免费复制代码 和博主大V互动 下载海量资源 发动态/写文章/加入社区 × 立即登录 自定义博客皮肤 VIP专享 * 博客头图: 点击选择上传的图片 格式为PNG､JPG,宽度*高度大于1920*100像素,不超过2MB,主视觉建议放在右侧,请参照线上博客头图 请上传大于1920*100像素的图片! 博客底图: 点击选择上传的图片 
Source: https://blog.csdn.net/pang9998/category_9398285.html

**algorithm/2d_list.md at master · YuechengLi/algorithm · GitHub** (2025-03-01)
master Breadcrumbs 2d_list.md Copy path Blame Blame Latest commit 104 lines (80 loc) · 3.59 KB   master Breadcrumbs 2d_list.md Top File metadata and controls Preview Code Blame 104 lines (80 loc) · 3.59 KB #问题 定义一个20*5的二维数组,用来存储某班级20位学员的5门课的成绩; /usr/bin/env python#coding:utf-8from __future__ import divisionimport randomdef score(score_list,course_list,student_num): course_num = len(course_list) every_score = [[score_list[j][i] for j in range(course_num)] for i in range(student_num)] every_total = [sum(every_score[i]) for i in range(student_num)] ave_course = [sum(score_list[i])/len(score_list[i]) for i in range(len(score_list))] return 
Source: https://github.com/YuechengLi/algorithm/blob/master/2d_list.md

**Algorithm2老旧版本大全_历史官方版安装下载_天极下载** (2026-04-25)
在这里,Algorithm2历史版本列表页最多提供该软件最近周期的10个升级版本,如果版本数量少,有2个原因:可能刚新增收录;可能是版本升级少的原因;给您带来不变,请您谅解;如果有喜欢Algorithm2旧版本操作界面的小伙伴,这里新旧版本应有尽有,感兴趣可以下载收藏哦!
Source: http://mydown.yesky.com/pcsoft/462810/versions/

**用LaTex写伪代码(使用algorithm2e包)_latex 伪代码每一行的数字行号-CSDN博客** (2021-10-05)
代码1{\color{<颜色名>}<原始代码内容>} AI写代码1实例: \begin{algorithm}[H] \caption{Put your caption here} \SetKwInput{KwInput}{Input} % Set the Input \SetKwInput{KwOutput}{Output} % set the Output \DontPrintSemicolon \KwInput{Your Input} \KwOutput{Your output} \KwData{Testing set $x$} % Set Function Names \SetKwFunction{FMain}{Main} \SetKwFunction{FSum}{Sum} \SetKwFunction{FSub}{Sub} % Write Function with word ``Function'' \SetKwProg{Fn}{Function}{:}{} \Fn{\FSum{$first$, $second$}}{ a = first\; b = second\;
Source: https://blog.csdn.net/amnesiagreen/article/details/120609867

**Algorithm2下载2026最新电脑版-Algorithm2官方PC版免费下载-天极下载** (2016-11-24)
软件简介 Algorithm2是一个为游戏和软件开发都使用的免费工具｡有了它 ,任何人都可以创建程序,不需要任何编程语言知识｡截至最新的版本,这它可以让你创建自己的多媒体播放器､浏览器､文本编辑器,制作系统屏幕､系统注册表､键盘和鼠标工具 下载地址 普通下载地址通道
Source: https://mydown.yesky.com/pcsoft/462810.html

**二维装箱问题之Next-Fit Algorithm的简单实现(C语言)_知乎** (2019-12-28)
 Code 代码包括 数据读取 计算时间测量 Next-Fit Algorithm 输出结果 #include <stdlib.h> #include <stdio.h> #include <time.h> #define FALSE 0 #define TRUE 1 #define MAX_N 10000 double strip_width, strip_height; /* 长方形个数 */ double w[MAX_N], h[MAX_N]; /* w[i]h[i]/ double x[MAX_N], y[MAX_N]; /* 坐标(x[i],y[i])*/ void next_fit(); int main(){ FILE *input_file, *output_file; double start_time, search_time; double area, efficiency; int i; //读取数据 input_file = fopen("N1.rec", "r"); fscanf(input_file, "w= %lf\n", &strip_width); fscanf(input_file, 
Source: https://zhuanlan.zhihu.com/p/99901004

**C 头文件系列 (algorithm) - lgxZJ - 博客园** (2017-02-08)
简介 algorithm头文件是C++的标准算法库,它主要应用在容器上｡ 该版本一般带有 if 字样｡ Non-modifying sequence operations all_of : 判断是否范围内的所有元素 都满足 条件｡ any_of : 判断是否范围内的所有元素中 有一个满足 条件｡ none_of : 判断是否范围内的所有元素中 没有一个满足 条件｡ for_each : 对指定范围内的每一个元素进行指定的操作｡ find､find_if､find_if_not : 在指定范围中 查找满足某个条件 (值相等､条件满足､条件不满足)的元素｡ find_end : 在指定序列中 查找最后一个相等 (或满足谓词条件) 子序列 ｡ find_first_of : 在指定序列中 查找第一个出现在另一个序列中 (或满足谓词条件) 的元素 ｡ adjacent_find : 在指定序列中 查找第一个相等 (值相等､满足条件) 的元素对 (2个元素)｡ count､count_if : 对制定序列中的满足条件(值相等､满足条件)的元素进行计数｡ mismatch : 给定两个元素序列,返回 第一个不匹配 (值不相等､不满足条件)的元素位置,以一个 迭代器对 指出｡
Source: https://www.cnblogs.com/lgxZJ/p/6377437.html

**Latex排版Algorithm之algorithmic,algorithmicx,algorithm2e_latex algorithmic-CSDN博客** (2024-12-23)
algorithmic是第一代算法排版环境algorithmicx是第二代算法排版环境algorithm2e是第三版算法排版环境以上三种算法排版环境中algorithmic比较老了,现在用的较多的是algorithmicx和algorithm2e排版环境｡并且这三种排版环境不能混用｡我个人比较喜欢algorithm2e的排版样式｡具体参考这个链接 
Source: https://blog.csdn.net/ChinaZm/article/details/123211818

**algorithm/2d_list.py at master · lzufengye/algorithm · GitHub** (2026-06-05)
Navigation Menu Toggle navigation Appearance settings Search or jump to... Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly Cancel Create saved search 
Source: https://github.com/lzufengye/algorithm/blob/master/2d_list.py


**Sources**:
- [latex 算法,算法包 algorithm, algorithm2e-CSDN博客](https://blog.csdn.net/robert_chen1988/article/details/71512914)
- [Algorithm(算法)_pang9998的博客-CSDN博客](https://blog.csdn.net/pang9998/category_9398285.html)
- [algorithm/2d_list.md at master · YuechengLi/algorithm · GitHub](https://github.com/YuechengLi/algorithm/blob/master/2d_list.md)
- [Algorithm2老旧版本大全_历史官方版安装下载_天极下载](http://mydown.yesky.com/pcsoft/462810/versions/)
- [用LaTex写伪代码(使用algorithm2e包)_latex 伪代码每一行的数字行号-CSDN博客](https://blog.csdn.net/amnesiagreen/article/details/120609867)
- [Algorithm2下载2026最新电脑版-Algorithm2官方PC版免费下载-天极下载](https://mydown.yesky.com/pcsoft/462810.html)
- [二维装箱问题之Next-Fit Algorithm的简单实现(C语言)_知乎](https://zhuanlan.zhihu.com/p/99901004)
- [C 头文件系列 (algorithm) - lgxZJ - 博客园](https://www.cnblogs.com/lgxZJ/p/6377437.html)
- [Latex排版Algorithm之algorithmic,algorithmicx,algorithm2e_latex algorithmic-CSDN博客](https://blog.csdn.net/ChinaZm/article/details/123211818)
- [algorithm/2d_list.py at master · lzufengye/algorithm · GitHub](https://github.com/lzufengye/algorithm/blob/master/2d_list.py)

---

## Query 3: GDC talk fog of war implementation
**Latency**: 2.45s

**fog-of-war/README.md at main · wblachut/fog-of-war · GitHub** (2026-03-25)
tree   main More file actions More file actions Latest commit History 115 lines (89 loc) · 7.6 KB   main Breadcrumbs README.md Top File metadata and controls Preview Code Blame 115 lines (89 loc) · 7.6 KB Outline Edit and raw actions Table of Contents About This Project is a web application that simulates map exploration commonly known in games as fog of war . The project uses html <canvas> elements to display map elements as raster graphics. Move the player with arrow keys or by dragging the mouse to uncover the map. Your progress is shown in the bottom right corner. Running the App To run the app follow the steps: Clone GitHub repository 
Source: https://github.com/wblachut/fog-of-war/blob/main/README.md

**越战回忆录** (2026-06-23)
"【中 文 名】越战回忆录/战争迷雾-罗伯特·麦克纳马拉生命中的11个教训 刚刚获得第76届奥斯卡最佳纪录长片的《战争迷雾/THE FOG OF WAR》,是由美国著名独立纪录片导演埃罗尔·莫里斯(Errol Morris)编导的｡这是一部什么内容的影片,让我们看看《战争迷雾》的副标题就可以略知端倪,《战争迷雾》的副标题是“罗伯特·麦克纳马拉生命中的 11个教训/Eleven Lessons 
Source: https://baike.baidu.com/item/%E8%B6%8A%E6%88%98%E5%9B%9E%E5%BF%86%E5%BD%95/7150318

**fog-of-war · GitHub Topics · GitHub** (2024-08-03)
Navigation Menu Toggle navigation Appearance settings Product Solutions Resources Search or jump to... Provide feedback Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly Cancel Create saved search Appearance settings Resetting focus You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert Here are 10 public repositories matching this topic... Language: C# Filter by language A .NET Standard class library providing map 
Source: https://github.com/topics/fog-of-war?l=c%2523

**GCTF International Workshop—Combating Transnational Fraud** (2026-05-22)
承認:ｴデｨﾀ On March 25-27, the Japan-Taiwan Exchange Association co-hosted a Global Cooperation and Training Framework (GCTF) workshop with the theme of “Combating Transnational Fraud” with Taiwan’s 
Source: https://www.koryu.or.jp/en/business/gctf/20240325/

**FOG 又签约一球队!新装备发布!** (2025-09-20)
<p><img src='http://qqpublic.qpic.cn/qq_public/0/28-1845641628-EE8F44AC1EF68D40BD64522664F65048/0?fmt=jpg&size=44&h=616&w=900&ppv=1' data-aigc-mark='0'/></p><p>继和 NCAA 篮球校队的合作之后,Fear of God 
Source: https://so.html5.qq.com/page/real/search_news?docid=70000021_95068ce2a1962352

**战争迷雾** (2022-07-04)
"战争迷雾,RTS类游戏的一种用语｡是指在战争游戏中制造双方战术不可预测性的机制,在最早战争游戏中并没有战争迷雾的概念｡概念与来源战争迷雾是指在战争游戏中制造双方战术不可预测性的机制,在最早战争游戏中并没有战争迷雾的概念,而仅仅只有遮盖地图的地理地形地貌的黑雾(英文名称:Black fog)最早的RTS游戏譬如DUNE2,沙丘等的迷雾仅仅只属于“黑雾”的范畴(Black 
Source: https://baike.baidu.com/item/%E6%88%98%E4%BA%89%E8%BF%B7%E9%9B%BE/22684611

**GDCM:gdcm::SequenceOfFragments的测试程序_gdcm sequenceoffragments-CSDN博客** (2023-09-08)
GDCM:gdcm::SequenceOfFragments的测试程序 gdcm::SequenceOfFragments是GDCM(Grassroots DICOM)库中的一个重要类,它用于处理DICOM(数字成像和通信医学)文件中的序列片段数据｡ 首先,我们需要确保已经安装了GDCM库,并在编译时链接到我们的程序中｡接下来,我们将创建一个名为"test_gdcm_sequence.cpp"的源代码文件,并包含必要的头文件: #include "gdcmReader.h" #include "gdcmAttribute.h" #cpp12
Source: https://blog.csdn.net/CyberXZ/article/details/132750430

**战争权力60天门槛已至:美国陷入“非战争”的战争** (2026-05-01)
<p>当地时间4月30日,美国众议院议长迈克·约翰逊在国会大厦接受采访时称,美国目前与伊朗“并未处于战争状态”,国会没有必要介入特朗普政府针对伊朗的军事行动｡</p><p>此番表态出现在一个敏感节点｡特朗普政府3月2日就对伊朗敌对行动向国会作出通报,按照1973年《战争权力决议案》,相关军事行动的60天期限将在5月1日到来｡
Source: https://so.html5.qq.com/page/real/search_news?docid=70000021_70469f4286139552

**GD32写4字节flash函数_gd32 iapflashwrite-CSDN博客** (2021-08-19)
GD32的写入flash代码,写入32位数据: 主要是fmc的解锁上锁,然后用的是gd32f30x_fmc.c的函数 fmc_page_erase——擦除,(一页1KB或者2KB 具体看芯片代码) fmc_word_program——字写入(uint32_t) 如果需要半字写入,那就替换为下边这个函数: fmc_halfword_program——半字写入(uint16_t) void iap_write_u32(uint32_t appxaddr,uint32_t data){ fmc_unlock(); fmc_page_erase(APP_LEN_ADDR);
Source: https://blog.csdn.net/qq_42479987/article/details/119796041

**阿兰达蒂·洛伊** (2024-12-20)
"阿兰达蒂·洛伊(Arundhati Roy),1961年生于印度,她是一名用英语写作的印度作家,同时还是一位致力于社会公平和经济对等的左派分子｡16岁时离家,只身来到新德里,在学校主修建筑;毕业后做过记者､编辑,后从事电影文学剧本写作｡37岁凭借《微物之神》成为第一个获得全美国图书奖､英国文学大奖“布克奖”的印度作家,震惊世界文坛｡人物简介阿兰达蒂·洛伊(Arundhati 
Source: https://baike.sogou.com/v51010340.htm


**Sources**:
- [fog-of-war/README.md at main · wblachut/fog-of-war · GitHub](https://github.com/wblachut/fog-of-war/blob/main/README.md)
- [越战回忆录](https://baike.baidu.com/item/%E8%B6%8A%E6%88%98%E5%9B%9E%E5%BF%86%E5%BD%95/7150318)
- [fog-of-war · GitHub Topics · GitHub](https://github.com/topics/fog-of-war?l=c%2523)
- [GCTF International Workshop—Combating Transnational Fraud](https://www.koryu.or.jp/en/business/gctf/20240325/)
- [FOG 又签约一球队!新装备发布!](https://so.html5.qq.com/page/real/search_news?docid=70000021_95068ce2a1962352)
- [战争迷雾](https://baike.baidu.com/item/%E6%88%98%E4%BA%89%E8%BF%B7%E9%9B%BE/22684611)
- [GDCM:gdcm::SequenceOfFragments的测试程序_gdcm sequenceoffragments-CSDN博客](https://blog.csdn.net/CyberXZ/article/details/132750430)
- [战争权力60天门槛已至:美国陷入“非战争”的战争](https://so.html5.qq.com/page/real/search_news?docid=70000021_70469f4286139552)
- [GD32写4字节flash函数_gd32 iapflashwrite-CSDN博客](https://blog.csdn.net/qq_42479987/article/details/119796041)
- [阿兰达蒂·洛伊](https://baike.sogou.com/v51010340.htm)

---

## Query 4: Reddit gamedev fog of war soft edge gradient shader
**Latency**: 2.9s

**[MS-EMMWCF]: ChangeDataForAddOrDeleteLanguage  Microsoft Learn** (2025-03-18)
This browser is no longer supported. Upgrade to Microsoft Edge to take advantage of the latest features, security updates, and technical support. Table of contents Exit editor mode Ask Learn Ask 
Source: http://msdn.microsoft.com/en-us/library/dd944813(v=office.12).aspx

**Steam Deck 玩家在 Reddit 发心声:掌机买了这么多年就玩一款** (2026-06-04)
<p>IT之家 6 月 4 日消息,据外媒 Notebook Check 报道,尽管 V 社的 Steam Deck 游戏机“几乎什么都能干”,不过最近 Reddit 上一则热门讨论却显示,很多玩家实际上只把它当成“一款游戏专用机”来使用｡</p><p><img src='http://qqpublic.qpic.
Source: https://so.html5.qq.com/page/real/search_news?docid=70000021_7966a215a9e54852

**即将对战VIT,DRG发布赛前返图:热身完毕** (2026-06-07)

Source: https://new.qq.com/rain/a/20260607A00MBY00

**杨付正** (2024-09-06)
"现为西安电子科技大学信息与通信系统学科博士,教授,硕士研究生导师｡工作于西安电子科技大学通信工程学院信息科学研究所多媒体通信实验室基本介绍现为西安电子科技大学信息与通信系统学科博士,副教授,硕士研究生导师｡
Source: https://baike.sogou.com/v63488200.htm

**tagFUNCDESC.wFuncFlags Field (Microsoft.VisualStudio.VsWizard)  Microsoft Learn** (2024-02-26)
tagFUNCDESC. w Func Flags Field Definition Namespace: Assembly: Microsoft.VisualStudio.VsWizard.dll Holds the function flag properties. public: System::UInt16 wFuncFlags; C++/CX 复制 public : unsigned short wFuncFlags;
Source: http://msdn.microsoft.com/zh-cn/library/microsoft.visualstudio.vswizard.tagfuncdesc.wfuncflags.Aspx?cs-save-lang=1&cs-lang=cpp

**SelectedGridItemChangedEventHandler Delegar (System.Windows.Forms)  Microsoft Learn** (2025-07-01)
Versão Windows Desktop 10 AmbientProperties ApplicationContext AutoCompleteStringCollection AxHost. AxComponentEditor AxHost. ClsidAttribute AxHost. ConnectionPointCookie AxHost. 
Source: http://msdn.microsoft.com/pt-br/system.windows.forms.selectedgriditemchangedeventhandler.aspx

**CMFCVisualManager::IsShadowHighlightedImage  Microsoft Learn** (2011-07-25)
此浏览器不再受支持｡ 请升级到 Microsoft Edge 以使用最新的功能､安全更新和技术支持｡
Source: http://msdn.microsoft.com/zh-cn/library/bb983950(d=printer,v=vs.100)

**杨付正** (2023-11-23)
"现为西安电子科技大学信息与通信系统学科博士,教授,硕士研究生导师｡工作于西安电子科技大学通信工程学院信息科学研究所多媒体通信实验室个人简介2000年7月获西安电子科技大学通信工程专业本科学位,2003年3月及2005年6月分别获西安电子科技大学通信与信息系统专业硕士及博士学位｡2005年6月博士毕业后留校任教,2006年6月破格晋升为副教授,并于同年12月获硕士生研究生导师资格｡
Source: https://baike.baidu.com/item/%E6%9D%A8%E4%BB%98%E6%AD%A3/1698947

**AMD FSR Redstone 实装,《COD:黑色行动 7》支持 FSR 光线再生** (2025-11-14)
<p>IT之家 11 月 14 日消息,AMD 今年早些时候宣布了专属于 Radeon 9000 "RDNA 4" GPU 的 FSR 超级分辨锐画技术最新迭代 'Redstone',其基于机器学习的特质意味着能实现更出色的性能､更清晰的视觉效果以及更流畅的游戏体验｡</p><p>FSR 'Redstone' 包含四大组成部分,FSR 优化升级､FSR 帧生成､FSR 光线再生､FSR 辐射缓存｡
Source: https://so.html5.qq.com/page/real/search_news?docid=70000021_4656916825276852

**gbf-raidfinder/CHANGELOG.md at master · Hikariga/gbf-raidfinder · GitHub** (2017-04-05)
Collapse file tree Files master Search this repository (forward slash) forward slash / client docs project protocol server stream .gitignore CHANGELOG.md LICENSE Procfile README.md app.json build.sbt 
Source: https://github.com/Hikariga/gbf-raidfinder/blob/master/CHANGELOG.md


**Sources**:
- [[MS-EMMWCF]: ChangeDataForAddOrDeleteLanguage  Microsoft Learn](http://msdn.microsoft.com/en-us/library/dd944813(v=office.12).aspx)
- [Steam Deck 玩家在 Reddit 发心声:掌机买了这么多年就玩一款](https://so.html5.qq.com/page/real/search_news?docid=70000021_7966a215a9e54852)
- [即将对战VIT,DRG发布赛前返图:热身完毕](https://new.qq.com/rain/a/20260607A00MBY00)
- [杨付正](https://baike.sogou.com/v63488200.htm)
- [tagFUNCDESC.wFuncFlags Field (Microsoft.VisualStudio.VsWizard)  Microsoft Learn](http://msdn.microsoft.com/zh-cn/library/microsoft.visualstudio.vswizard.tagfuncdesc.wfuncflags.Aspx?cs-save-lang=1&cs-lang=cpp)
- [SelectedGridItemChangedEventHandler Delegar (System.Windows.Forms)  Microsoft Learn](http://msdn.microsoft.com/pt-br/system.windows.forms.selectedgriditemchangedeventhandler.aspx)
- [CMFCVisualManager::IsShadowHighlightedImage  Microsoft Learn](http://msdn.microsoft.com/zh-cn/library/bb983950(d=printer,v=vs.100))
- [杨付正](https://baike.baidu.com/item/%E6%9D%A8%E4%BB%98%E6%AD%A3/1698947)
- [AMD FSR Redstone 实装,《COD:黑色行动 7》支持 FSR 光线再生](https://so.html5.qq.com/page/real/search_news?docid=70000021_4656916825276852)
- [gbf-raidfinder/CHANGELOG.md at master · Hikariga/gbf-raidfinder · GitHub](https://github.com/Hikariga/gbf-raidfinder/blob/master/CHANGELOG.md)

---

## Query 5: RimMap RimWorld fog of war pixel
**Latency**: 3.02s

**GitHub - KuronoaScarlet/ResearchFogOfWar: A small demo for the implementation of fog of war in SDL2. Enjoy it! · GitHub** (2021-05-11)
master Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit KuronoaScarlet Update index.md May 11, 2021 38d1de5 · May 11, 2021 History 65 Commits Open commit details 65 Commits docs docs Update index.md May 11, 2021 handout handout Cositas para poner los TODO en Pages May 10, 2021 solution solution Cambios chiquitos May 10, 2021 .gitignore .gitignore Initial commit May 3, 2021 CONVENTIONS.md CONVENTIONS.md Initial commit May 3, 2021 LICENSE LICENSE Initial commit May 3, 2021 README.md README.md Update README.md May 11, 2021 View all files Repository files navigation Fog of War 
Source: https://github.com/KuronoaScarlet/ResearchFogOfWar

**MadRocketFogofwarInspiredbyRTS手游_MadRocketFogofwarInspiredbyRTS安卓预约下载最新手机正版链接_豌豆荚官网** (2026-04-14)
to Mad Rocket: come with a new BOOM strategy! Dark Fog is covering the base, we can’t locate their defenses. We need completely different plans to battle against the enemies! Destroy enemy bases that are hidden under the fog and to build an ultimate base that no one can penetrate in this epic combat strategy game. But don't worry. Highly explosive Rocket Missile and Aircraft are carry out your strategy against hidden defenses. Fight against the unpredictable defense strategies of them. Forget the old. It’s time to plan completely different strategies! Boom-Boom Rocket! FEATURES - Use the fog of war to your advantage with covert tactics! - 
Source: https://www.wandoujia.com/download/267018/

**Steam 上的 Fog Of War - Complete Edition** (2026-04-21)
个人资料功能受限 语言 界面 完全音频 字幕 简体中文 不支持 英语 ✔ 俄语 ✔ 名称: Fog Of War - Complete Edition 开发者: Monkeys Lab. 发行日期: 2018 年2月22 日 不支持简体中文 本产品尚未对您目前所在的地区语言提供支持｡在购买请先行确认目前所支持的语言｡ DLC 此内容需要在 Steam 上拥有基础游戏Fog Of War - 
Source: https://store.steampowered.com/app/791890/

**Unity Fog of War 资产详解:unity实现高效战争迷雾系统_unity 2d迷雾-CSDN博客** (2025-08-01)
今天来详细拆解一个强大的Unity资产——Fog of War(简称FOW)｡这个资产位于我的项目路径/d:/unity/SimWar/Assets/FogOfWar,它是一个完整的战争迷雾系统,支持Built-in RP､URP和HDRP渲染管道｡Fog of War是RTS(即时战略)游戏的核心机制,能模拟战场上的未知区域,只有玩家单位靠近时才会揭示地图,增加策略性和沉浸感｡) 资产概述 Fog of War资产的核心是实现动态迷雾揭示,支持3D和2D场景｡它使用射线投射(Raycasting)和后处理效果来渲染未知区域,特点包括: 多渲染管道支持:Built-in(legacy)､URP和HDRP,通过unitypackage快速切换｡ 柔和效果:支持硬边/软边迷雾､模糊､纹理采样和轮廓线｡ 性能优化:利用Unity Job系统､Burst编译和Compute Buffer处理大量射线｡ 自定义选项:迷雾颜色､软化距离､再生速度､世界边界等｡ Shaders/:自定义着色器,如FOW_RT(渲染纹理)和FullScreen/FOW(后处理)｡ Scripts/:核心脚本,包括FogOfWarWorld.cs(全局管理)､FogOfWarRevealer3D.cs(揭示者)和FOWImageEffect.cs(相机效果)｡
Source: https://blog.csdn.net/m0_46642453/article/details/149842973

**环世界圆形mod-今日头条** (2025-11-07)
《RimWorld》是一款由Dwarf Fortress开发的科幻殖民模拟类游戏｡本次在Steam上的抢先体验将会采用全新的场景系统,让玩家可以有许多不同的开局环境选择,还可以自己自定义｡为了省去一些麻烦,这些定制方案可以随机,然后再手工编辑｡ 17173游戏网 一款类环世界的模拟建造生存游戏 《山下之王》是由Rocket Jump 
Source: https://www.toutiao.com/topic/7499700321845807158/

**GitHub - metaphore/unity-fog-of-war-demo: A basic cloudy 2D fog of war based on tilemap.** (2022-04-18)
Navigation Menu Toggle navigation Solutions Resources Search or jump to... Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly Cancel Create saved search You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert metaphore/unity-fog-of-war-demo   master Go to file Code Folders and files Name Name Last commit message Last commit date Latest commit   History 7 Commits Assets Assets     Packages Packages     ProjectSettings 
Source: https://github.com/metaphore/unity-fog-of-war-demo

**Unity3d Pixel-Perfect Fog Of War 1.4.5 对象投射视野隐藏插件 - 哔哩哔哩** (2023-02-26)
大小14.6 MB 最新版本1.4.6 描述 Pixel Perfect Fog of war是终极战争迷雾工具｡ 下载Windows演示版本 与此问题的大多数解决方案不同,Pixel Perfect Fog Of War无需渲染纹理即可操作,所有计算都在GPU上完成｡这意味着系统非常快,并产生Pixel Perfect结果｡ 利用图像效果､URP自定义渲染功能和HDRP体积框架,该工具与现有项目兼容,并且材质不需要自定义着色器｡ 该软件包具有在战争迷雾中隐藏某些游戏对象的功能｡ 此软件包允许您自定义战争雾,并提供4种雾(见屏幕截图),允许您调整显示者的视角和视图半径,更改战争雾颜色,以及通过添加角来显示对象顶部的选项(见屏幕快照)｡ 该项目利用C#作业系统和Burst编译器来确保最佳性能｡ 使用1.2版,现在可以自定义雾渲染模式｡Pixel Perfect Fog Of War具有4种默认渲染模式: 纯色-雾渲染为纯色 灰度-雾使场景淡化 模糊-雾模糊并更改场景的颜色 纹理采样-雾使用“三平面贴图”对纹理进行采样,以覆盖雾区域的纹理 1.3版增加了新功能: Physics2D支持 轴选择(选择FOW平面) 灰度雾的颜色预乘 改进的模糊雾模式 FOW现在可以在移动设备上渲染 可控制的视觉高度 许多其他改进和优化 团队演示,在运行时进行团队交换 https://www.cgdashen.com/10899.html?
Source: https://www.bilibili.com/read/cv22063337

**Rules that modify player perspectives (e.g. fog of war) · Issue #30 · alexobviously/bishop · GitHub** (2023-01-30)
Issue body actions Although it's technically possible to do this sort of thing (and maybe implement it in Square Bishop), it would be useful to implement this sort of thing in Bishop itself, so that 
Source: https://github.com/alexobviously/bishop/issues/30

**梅森1999年画的魔兽世界地图,按着这个做魔兽2应该很有意思** (2025-11-02)
<p>克里斯·梅森在1999年画的一版《魔兽世界》的全地图,跟现在有点相似,但是也有大不同｡</p><p>右边东部王国,几乎和现在一样,是魔兽世界早期最完善的一个地图设计｡北边的诺森德也是“巫妖王之怒”资料片按着去做的地图,整体很相近,地图上标记的冰封王座､风暴群山､古达克､蜘蛛王国都得到了还原｡</p><p>不过卡利姆多在原始设计中是一块很小的陆地,而奥杜尔在左下角则是非常巨大的一块区域｡
Source: https://so.html5.qq.com/page/real/search_news?docid=70000021_9496906efef99552

**战争世纪** (2026-06-01)
语言:中文 大小:807.77 MB 战争世纪 是一款融合即时战略与沙盒探索的SLG手游｡作为文明领袖,你需要统筹资源采集､科技研发与军队建设,在广袤的实时地图上与全球玩家展开领土争夺｡游戏独创多线程操作体系,配合地形影响下的兵种克制系统,让每场战役都充满变数｡联盟成员可共享科技树,通过协同作战攻占世界奇观｡二十分钟一局的快节奏设计,既保留了SLG的深度策略,又兼顾了移动端的碎片化体验｡ 
Source: https://www.pchome.net/games/708737.html


**Sources**:
- [GitHub - KuronoaScarlet/ResearchFogOfWar: A small demo for the implementation of fog of war in SDL2. Enjoy it! · GitHub](https://github.com/KuronoaScarlet/ResearchFogOfWar)
- [MadRocketFogofwarInspiredbyRTS手游_MadRocketFogofwarInspiredbyRTS安卓预约下载最新手机正版链接_豌豆荚官网](https://www.wandoujia.com/download/267018/)
- [Steam 上的 Fog Of War - Complete Edition](https://store.steampowered.com/app/791890/)
- [Unity Fog of War 资产详解:unity实现高效战争迷雾系统_unity 2d迷雾-CSDN博客](https://blog.csdn.net/m0_46642453/article/details/149842973)
- [环世界圆形mod-今日头条](https://www.toutiao.com/topic/7499700321845807158/)
- [GitHub - metaphore/unity-fog-of-war-demo: A basic cloudy 2D fog of war based on tilemap.](https://github.com/metaphore/unity-fog-of-war-demo)
- [Unity3d Pixel-Perfect Fog Of War 1.4.5 对象投射视野隐藏插件 - 哔哩哔哩](https://www.bilibili.com/read/cv22063337)
- [Rules that modify player perspectives (e.g. fog of war) · Issue #30 · alexobviously/bishop · GitHub](https://github.com/alexobviously/bishop/issues/30)
- [梅森1999年画的魔兽世界地图,按着这个做魔兽2应该很有意思](https://so.html5.qq.com/page/real/search_news?docid=70000021_9496906efef99552)
- [战争世纪](https://www.pchome.net/games/708737.html)

---

## Query 6: Civilization 6 fog of war stylized edge clouds
**Latency**: 3.35s

**EA《战地风云 6》全球解锁时间表放出** (2025-10-05)
IT之家 10 月 5 日消息,EA《战地风云 6》官推正式放出了全球解锁时间表,本作将于北京时间 10 月 10 日晚 11 点上线,登陆 PS5 / Xbox Series X|S / PC 平台｡      据介绍,《战地风云 6》已经开启 Beta 公测,支持 PS5､XSX|S 和 PC 平台,目前并无登陆 Switch 2 的计划,同时也不会专门为 Steam Deck 提供适配支持｡
Source: https://new.qq.com/rain/a/20251005A05OTV00

**EA《战地风云 6》游戏首支官方预告片公布** (2025-07-24)
IT之家 7 月 24 日消息,EA 今日公布了<strong>《战地风云 6》游戏的首支官方预告片</strong>,还将在 7 月 31 日公布《战地风云 6》的多人模式｡</p><p>尖端私人军事公司“和平军团”踏上破坏之路,不惜一切破坏北约及其同盟国,誓要捍卫“我们保护,你们和平”这一座右铭｡</p><p>子弹上膛,终极全面战争已经箭在弦上!
Source: https://so.html5.qq.com/page/real/search_news?docid=70000021_02668824d9626852

**GitHub - LexdevTutorials/CivilizationFogOfWarTemplate: https://lexdev.net/tutorials/case_studies/civilization_fogofwar.html · GitHub** (2026-06-12)
  master Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit   History 4 Commits 4 Commits CivilizationFogOfWarUnityProject CivilizationFogOfWarUnityProject     .gitignore .gitignore     LICENSE LICENSE     README.md README.md     View all files Repository files navigation Lexdev tutorial project. You can find the full tutorial here: https://lexdev.net/tutorials/case_studies/civilization_fogofwar.html No releases published Uh oh! There was an error while loading. Please reload this page . Uh oh! There was an error while loading. Please reload this page . Languages Footer © 2026 GitHub, Inc. Footer navigation Manage cookies Do not share my personal information You can’t perform that action at this time.
Source: https://github.com/LexdevTutorials/CivilizationFogOfWarTemplate

**GitHub - FrozenWind6/disconf: Distributed Configuration Management Platform(分布式配置管理平台)** (2025-09-13)
Appearance settings Platform Solutions Resources Search or jump to... Provide feedback Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly Cancel Create saved search Appearance settings Resetting focus You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert FrozenWind6/disconf   master Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit   History 1,156 Commits disconf-client disconf-client     disconf-core disconf-core     disconf-web disconf-web     docs docs     sql sql     .gitignore .gitignore     .travis.yml .travis.yml     LICENSE LICENSE     README.md README.md     pom.xml pom.xml     View all files Repository files navigation Disconf 专注于各种「分布式系统配置管理」的「通用组件」和「通用平台」, 提供统一的「配置管理服务」 包括 百度 、 滴滴出行
Source: https://github.com/FrozenWind6/disconf

**civilization 6** (2026-06-22)
civilization 6 Random Post No links found. Copyright - civilization 6
Source: https://www.civilization6.net/

**11.0.3 · silverwind/cidr-tools@c2bfa6f · GitHub** (2025-02-14)
Navigation Menu Toggle navigation Appearance settings Product Solutions Resources Search or jump to... Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly Cancel Create saved search Appearance settings Resetting focus You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert Run details Triggered via push Status Success Total duration 29s Artifacts – You can’t perform that action at this time.
Source: https://github.com/silverwind/cidr-tools/actions/runs/13334088202

**Civilization 6 strategies - How to master the early game, mid-game and late game phases  Eurogamer.net** (2021-01-12)
Now you've got the basics, here's how to dominate each phase of your campaign. Follow Sid Meier's Civilization 6 The joy of this game, as with all previous entries in this series, is that there are multiple ways to play and a myriad of Civilization 6 strategies that you can take on your way to one of the many victory types. Having consumed the various pages of this guide from essential tips and tricks to a detailed look at the Leaders and managing Districts , you are well placed to strike out on your own and lead your Civilization to glory. Civilization 6 Interview - 18 minutes with lead designer, Ed Beach (plus some new gameplay) Watch on YouTube That said, forewarned is most certainly forearmed and we have so much more to give. So, whether you're hungry for squick note: we've refreshed out Civ 6 guides for the game's launch on Nintendo Switch, but just be aware that they contain information regarding the Rise and Fall DLC as well as the base game, which mue as to what the most import
Source: https://www.eurogamer.net/articles/2018-11-16-civilization-6-strategies-early-mid-late-game-phases-4879

**GitHub - ilri/ckm-cgspace-data-visualizer: A demo app showing a few data visualizations based on content from CGSpace, https://cgspace** (2026-06-11)
  master Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit   History 1 Commit 1 Commit .meteor .meteor     client client     server server     .gitignore .gitignore     LICENSE.md LICENSE.md     README.md README.md     package.json package.json     View all files Repository files navigation Data Visualization Demo A proof of concept that demonstrates a few data visualizations from content in CGSpace, https://cgspace.cgiar.org . The list of visualizations to be demonstrated are: Circle Packing : Communities, their sub-communities and their collections displayed as nested circles. Bubble Charts : Words in the Abstract/Description of an item drawn as circles with varying sizes based on their frequency of occurrence. Galaxy Chart : Items in the database counter per collection in a community. No releases published Uh oh! There was an error while loading. Please reload this page . Uh oh! There was an error while loading. Ple
Source: https://github.com/ilri/ckm-cgspace-data-visualizer

**GitHub - engagedIN/csrf: gorilla/csrf provides Cross Site Request Forgery (CSRF) prevention middleware for Go web applications & services** (2026-06-02)
Name Name Last commit message Last commit date Latest commit   History 102 Commits 102 Commits .circleci .circleci     .github .github     AUTHORS AUTHORS     Gopkg.lock Gopkg.lock     Gopkg.toml Gopkinenance. You can read more here: https://github.com/gorilla#gorilla-toolkit The csrf.Protect middleware/handler provides CSRF protection on routesattached to a router or a sub-router. A csrf.Token fuamework that rallies around Go's http.Handler interface. gorilla/csrf is also compatible with middleware 'helper' libraries like Alice and Negroni . Contents Install With a properly configured Go toolchain: go get github.com/gorilla/csrf Examples gorilla/csrf is easy to use: add the middleware to your router withthe below: CSRF := csrf . Protect ([] byte ( "32-byte-long-auth-key" )) http JavaScript application on another domain, you can use the Trusted Originsfeature to allow the host of your JavaScript application to make requests to your Go application. Observe the example below: pte can be 
Source: https://github.com/engagedIN/csrf

**GitHub - codingride/countries-states-cities-database: World countries, states/regions, cities in JSON, SQL, XML, PLIST, YAML and CSV** (2020-05-24)
Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly Cancel Create saved search You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert codingride/countries-states-cities-database   master Go to file Code Folders and files Name Name Last commit message Last commit date Latest commit   History 128 Commits .github .github     csv csv     docs docs     plist plist     raw raw     scripts scripts     sql sql     xml xml     yml yml     .gitignore .gitignore     CONTRIBUTING.md CONTRIBUTING.md     README.md README.md     cities.json cities.json     countries+states+cities.json countries+states+cities.json     countries+states.json countries+states.json     countries.json countries.json     states+cities.json states+cities.json     states.json states.json     View all fi
Source: https://github.com/codingride/countries-states-cities-database/tree/master


**Sources**:
- [EA《战地风云 6》全球解锁时间表放出](https://new.qq.com/rain/a/20251005A05OTV00)
- [EA《战地风云 6》游戏首支官方预告片公布](https://so.html5.qq.com/page/real/search_news?docid=70000021_02668824d9626852)
- [GitHub - LexdevTutorials/CivilizationFogOfWarTemplate: https://lexdev.net/tutorials/case_studies/civilization_fogofwar.html · GitHub](https://github.com/LexdevTutorials/CivilizationFogOfWarTemplate)
- [GitHub - FrozenWind6/disconf: Distributed Configuration Management Platform(分布式配置管理平台)](https://github.com/FrozenWind6/disconf)
- [civilization 6](https://www.civilization6.net/)
- [11.0.3 · silverwind/cidr-tools@c2bfa6f · GitHub](https://github.com/silverwind/cidr-tools/actions/runs/13334088202)
- [Civilization 6 strategies - How to master the early game, mid-game and late game phases  Eurogamer.net](https://www.eurogamer.net/articles/2018-11-16-civilization-6-strategies-early-mid-late-game-phases-4879)
- [GitHub - ilri/ckm-cgspace-data-visualizer: A demo app showing a few data visualizations based on content from CGSpace, https://cgspace](https://github.com/ilri/ckm-cgspace-data-visualizer)
- [GitHub - engagedIN/csrf: gorilla/csrf provides Cross Site Request Forgery (CSRF) prevention middleware for Go web applications & services](https://github.com/engagedIN/csrf)
- [GitHub - codingride/countries-states-cities-database: World countries, states/regions, cities in JSON, SQL, XML, PLIST, YAML and CSV](https://github.com/codingride/countries-states-cities-database/tree/master)

---

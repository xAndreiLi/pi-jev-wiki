# TypeSafe AI Releases Jev: A System One Model That Returns Typed, Calibrated Decisions Instead of Text

The ChatGPT moment in 2022 taught AI to talk to people. One of its builders now bets the next moment is AI that talks to software, not people. [TypeSafe AI](https://typesafe.ai/) released [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev). Jev is transformer-based, but it is not a large language model. It does not generate text. You send a state and typed questions. It returns typed decisions with probabilities that code can branch on.

**Is it deployable?** Yes, as a hosted API in early access behind a waitlist. TypeSafe has not published weights, a parameter count, or a self-hosting option.

## **What is a System One Model?**

The name borrows from Daniel Kahneman’s split between fast intuition and slow reasoning. TypeSafe team argues RLHF tuned models for human preference. That produced chat, and overconfidence and mode dropping. Those flaws keep a human in the loop.

Jev uses a new stack: a new architecture, a parallel sampler, and Reinforcement Learning for Calibrated Decisions (RLCD). TypeSafe has not disclosed the architecture.

## **How the Jev API Works**

One endpoint handles everything: `POST https://api.typesafe.ai/v1/systemone`. The body carries `state`, `model`, and a map of `questions`. The [docs](https://docs.typesafe.ai/introduction) define 3 question types.

Primitive

Asks

Returns

Choice

Pick 1 option from a list

`choice`, `probabilities`, `confidence`

Score

Rate against ordered levels

`score`, `probabilities`, `confidence`

Noul

Is this statement true?

`noul`, a probability from 0 to 1

Questions run in parallel and in isolation against the same state. TypeSafe says adding questions barely changes response time. A Choice supports up to 255 options.

```
from typesafe_sdk import Choice, Noul, TypeSafeClient

client = TypeSafeClient()  # reads TYPESAFE_API_KEY
r = client.system_one(
    state=ticket,
    questions={
        "department": Choice(
            instructions="Which team should handle this",
            criteria={"billing": "Payment issues", "technical": "Bugs"},
        ),
        "is_urgent": Noul(instructions="The message conveys urgency"),
    },
)
print(r.answers["department"].choice, r.answers["is_urgent"].noul)
```

Install with `pip install typesafe-sdk` (Python 3.10 or later). A JavaScript SDK ships as `@typesafe-ai/sdk`. The [quickstart](https://docs.typesafe.ai/introduction/quickstart) also covers cURL and an agent skill for Claude Code.

## **Confidence is the Product**

Every Choice and Score answer carries a [confidence](https://docs.typesafe.ai/confidence) value from 0 to 1. TypeSafe derives it from the shape of the probability distribution. In the docs example, `billing` wins at 0.84. Confidence is only 0.596, because `technical` still holds 0.159.

The docs suggest 3 paths. Act on high confidence. Review the middle. Send low confidence to a human. Thresholds should scale with the cost of a wrong action.

## **Pricing, Speed, and the Benchmark Fine Print**

Jev costs $42 per billion input tokens. TypeSafe quotes existing LLMs at $0.20 to $10 per 1M input tokens. In its recorded demo, Jev finished in 0.114s for $0.000081. GPT-5.6 Terra took 8.566s for $0.013880.

The TypeSafe team claims it to be 193.6x faster and 444.6x cheaper. Those figures come from TypeSafe’s own [workflow evals](https://evals.typesafe.ai/). **But hold on here are some things to keep in mind:**

*   The reference answer is the average of GPT-6 Astra and Fable 5.1.
*   TypeSafe’s capabilities team wrote the workflows.
*   TypeSafe expects these gains to sit at the high end of real use.
*   TypeSafe says it cannot prove the price is unsubsidized.

‘Zero hallucinations’ means schema matching is guaranteed. The 0% figure is not empirical. Answers can still be wrong.

## **What Developers are Building with Jev**

Community projects appeared within days of launch. **Here are some examples:**

*   **Command safety**: Vercel CEO [Guillermo Rauch](https://x.com/rauchg/status/2100307962262872105) reported Jev up to 18x faster at p95 than GPT Luna, and more accurate. His post said the fx reviewer still ran on Luna. Engineer [Pranit Sharma](https://x.com/fazxes/status/2100300097695232164/photo/1) shared the benchmark.
*   **Email triage**:Bryo AI CTO [Nikhil Mudholkar](https://x.com/nikhilmudholkar/status/2100604560335139083) found Gemini slightly more accurate, but 10 to 20 times more expensive.
*   **Browser agents**: Browser Use’s [jev-ultrafast](https://github.com/browser-use/jev-ultrafast) ran a Zürich to London Google Flights search in 7.1 seconds ([video](https://github.com/browser-use/jev-ultrafast/blob/main/docs/demo.mp4)).
*   **Phone agents**: Droidrun’s [mobile-jev](https://github.com/droidrun/mobile-jev) drove Uber on a real Android phone: 9 actions in about 21 seconds ([video](https://github.com/droidrun/mobile-jev/blob/main/docs/media/uber-demo.mp4)). No booking was completed.
*   **Video scoring**: [jevmeter](https://github.com/ChetasLua/jevmeter) scores every sentence of a debate for about $0.05 ([demo on X](https://x.com/chetaslua/status/2100473581251748216)).
*   **Live typing**: Steve Krouse’s [Typewriter](https://x.com/stevekrouse/status/2100287368221659289) updates 16 judgments as you type ([try it](https://typesafe-demo.val.run/)).
*   **Games**: Jev [completed StarCraft’s first combat mission](https://github.com/phyous/tsai-sc) ([video](https://github.com/phyous/tsai-sc/releases/download/v0.1.0/jev-starcraft-strongarm.mp4)). It also runs the guards in [heist-one](https://github.com/AbdelStark/heist-one) ([video](https://github.com/AbdelStark/heist-one/releases/download/v0.1.0/heist-one-launch.mp4)).
*   **Agent guardrails**: [jev-guard](https://github.com/leepokai/jev-guard) rates each tool call as deny, ask, or allow ([78-second video](https://github.com/leepokai/jev-guard/raw/main/assets/launch.mp4)).
*   **Data and homes**: [pg-jev](https://github.com/realZachi/pg-jev) adds plain-language filters to Postgres. [HA-Jev](https://github.com/AboveColin/HA-Jev) turns answers into Home Assistant entities.

## Interactive Explainer

## **Key Takeaways**

*   Jev outputs typed decisions with probabilities, not strings.
*   3 primitives (Choice, Score, Noul) can share 1 request.
*   Input costs $0.042 per 1M tokens. Output tokens are free.
*   TypeSafe reports 70ms to 500ms end-to-end response times.
*   The main benchmarks are vendor-run. Test on your own data.

* * *

Check out the [**launch post**](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [**docs**](https://docs.typesafe.ai/), and [**TypeSafe’s GitHub**](https://github.com/typesafe-ai/skills). All credit goes to the researcher of this project. Also, feel free to follow us on **[Twitter](https://x.com/intent/follow?screen_name=marktechpost)** and don’t forget to join our **[150k+ML SubReddit](https://www.reddit.com/r/machinelearningnews/)** and Subscribe to **[our Newsletter](https://magic.beehiiv.com/v1/f5e63dd4-5653-4f09-83e2-321a8b1ba526?email={{email}})**. Wait! are you on telegram? **[now you can join us on telegram as well.](https://t.me/machinelearningresearchnews)**

Need to partner with us for promoting your GitHub Repo OR Hugging Face Page OR Product Release OR Webinar etc.? **[Connect with us](https://forms.gle/MJjjVDPS7whH8Ngs6)**

[![](https://www.marktechpost.com/wp-content/uploads/2019/06/Screen-Shot-2021-09-14-at-9.02.24-AM-150x150.png)](https://www.marktechpost.com)

##### [Asif Razzaq](https://www.marktechpost.com/author/6flvq/)

Asif Razzaq is the CEO of Marktechpost AI Media Inc.. As a visionary entrepreneur and engineer, Asif is committed to harnessing the potential of Artificial Intelligence for social good. His most recent endeavor is the launch of an Artificial Intelligence Media Platform, Marktechpost, which stands out for its in-depth coverage of machine learning and deep learning news that is both technically sound and easily understandable by a wide audience. The platform boasts of over 2 million monthly views, illustrating its popularity among audiences.
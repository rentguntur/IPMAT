/* Shared auth + storage + topic/question data for the IPMAT site.
   Loaded on every page via <script src="app.js">. */

const IPMAT = (() => {

  // ---- CONFIG -------------------------------------------------------
  // Paste your Google Cloud OAuth Client ID here (public, safe to commit).
  const GOOGLE_CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const DATA_FILENAME = "ipmat-progress.json";

  // ---- AUTH -----------------------------------------------------------
  let tokenClient = null;
  let accessToken = sessionStorage.getItem("ipmat_token") || null;
  let onAuthChange = () => {};

  function initAuth(onChange) {
    onAuthChange = onChange || (() => {});
    if (!window.google || !google.accounts) {
      console.warn("Google Identity Services script not loaded.");
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.access_token) {
          accessToken = resp.access_token;
          sessionStorage.setItem("ipmat_token", accessToken);
          onAuthChange(true);
        }
      },
    });
    if (accessToken) onAuthChange(true);
  }

  function signIn() {
    if (!tokenClient) return;
    tokenClient.requestAccessToken({ prompt: "" });
  }

  function signOut() {
    if (accessToken && window.google) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    sessionStorage.removeItem("ipmat_token");
    onAuthChange(false);
  }

  function isSignedIn() {
    return !!accessToken;
  }

  // ---- STORE (Google Drive appDataFolder) ------------------------------
  const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  let fileId = null;

  function emptyData() {
    return { version: 1, attempts: [], mastery: {}, errorLog: [] };
  }

  async function findFileId() {
    const res = await fetch(
      `${DRIVE_FILES}?spaces=appDataFolder&q=name='${DATA_FILENAME}'&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const json = await res.json();
    return (json.files && json.files[0] && json.files[0].id) || null;
  }

  async function loadData() {
    if (!accessToken) return emptyData();
    fileId = await findFileId();
    if (!fileId) return emptyData();
    const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return emptyData();
    try {
      return await res.json();
    } catch {
      return emptyData();
    }
  }

  async function saveData(data) {
    if (!accessToken) throw new Error("Not signed in");
    const body = JSON.stringify(data);
    if (!fileId) fileId = await findFileId();

    if (!fileId) {
      const metadata = { name: DATA_FILENAME, parents: ["appDataFolder"] };
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", new Blob([body], { type: "application/json" }));
      const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const json = await res.json();
      fileId = json.id;
      return;
    }

    await fetch(`${DRIVE_UPLOAD}/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });
  }

  // ---- MASTERY GATE -----------------------------------------------------
  // 90%+ accuracy on a fresh drill of at least 15 questions.
  const MASTERY_MIN_QUESTIONS = 15;
  const MASTERY_MIN_ACCURACY = 0.9;

  function computeMastery(attempts, topicId) {
    const topicAttempts = attempts.filter((a) => a.topic === topicId);
    if (topicAttempts.length === 0) return { status: "not-started", accuracy: null };
    // "Fresh drill" = the most recent contiguous session (same sessionId).
    const lastSession = topicAttempts[topicAttempts.length - 1].sessionId;
    const sessionAttempts = topicAttempts.filter((a) => a.sessionId === lastSession);
    const correct = sessionAttempts.filter((a) => a.correct).length;
    const accuracy = correct / sessionAttempts.length;
    const mastered =
      sessionAttempts.length >= MASTERY_MIN_QUESTIONS && accuracy >= MASTERY_MIN_ACCURACY;
    return {
      status: mastered ? "mastered" : "in-progress",
      accuracy,
      questionsInLastSession: sessionAttempts.length,
    };
  }

  // ---- TOPIC / QUESTION REGISTRY -----------------------------------------
  // id must match the existing topic-<id>.html filename stem.
  const topics = [
    {
      id: "percentages",
      name: "Percentages",
      questions: [
        { q: "A number is increased by 25%, then decreased by 20%. Net % change?", a: "0% (net = 25 − 20 + (25×−20)/100 = 0)" },
        { q: "A shirt's price is increased by 30%, then decreased by 10%. Net % change?", a: "17% net increase" },
        { q: "If A's income is 25% more than B's, by what % is B's income less than A's?", a: "20% (base flips: B = A/1.25, less by 0.2A)" },
        { q: "45 out of 60 vs 38 out of 50 — which is the better score?", a: "38/50 = 76% is slightly better than 45/60 = 75%" },
        { q: "A number is decreased by 20% then increased by 25%. Net % change?", a: "0% (−20 + 25 + (−20×25)/100 = 5 − 5 = 0)" },
        { q: "Price of an item rises 10% for two years in a row. Total % rise?", a: "21% (10+10+(10×10)/100 = 21)" },
        { q: "What is 12.5% of 640?", a: "80 (1/8 of 640)" },
        { q: "A student scores 45 out of a max of 75. What percentage is this?", a: "60%" },
        { q: "If 40% of a number is 88, what is the number?", a: "220" },
        { q: "A's salary is reduced by 20%. By what % should it be increased to reach the original?", a: "25% (reduced base means bigger % needed to recover)" },
      ],
    },
    {
      id: "profit-loss",
      name: "Profit, Loss & Discount",
      questions: [
        { q: "CP = ₹800, SP = ₹920. Find profit %.", a: "15%" },
        { q: "An item marked ₹500 is sold at 20% discount. Find SP.", a: "₹400" },
        { q: "A shopkeeper marks up goods by 40% then gives 25% discount. Net effect on CP?", a: "Net = 40 − 25 + (40×−25)/100 = 5% profit" },
        { q: "SP = ₹690, loss = 8%. Find CP.", a: "CP = 690/0.92 = ₹750" },
        { q: "A trader marks his goods 50% above CP and allows a discount of 20%. Find his gain %.", a: "20% (50 − 20 + (50×−20)/100 = 30 − 10 = 20)" },
        { q: "By selling an article for ₹96, a man loses 20%. What should the SP be to gain 20%?", a: "CP = 120, SP for 20% gain = ₹144" },
        { q: "A dealer sold a machine at 5% loss. Had he sold it for ₹1500 more, he'd have gained 10%. Find CP.", a: "CP = 1500/0.15 = ₹10000" },
      ],
    },
    {
      id: "averages-alligation",
      name: "Averages, Mixtures & Alligation",
      questions: [
        { q: "Mix ₹40/kg rice with ₹60/kg rice to get ₹52/kg. Find the ratio.", a: "2:3 (cheaper:dearer)" },
        { q: "In what ratio must a 20% acid solution be mixed with a 50% acid solution to get a 30% solution?", a: "2:1 (20%:50%)" },
        { q: "A vessel has milk worth 25 on some scale, another 40. Mixed to get 30. Ratio of quantities?", a: "2:1" },
        { q: "A tank has 100L pure milk. 10L drawn and replaced with water, repeated twice more. Final milk?", a: "72.9L (100×(9/10)³)" },
        { q: "A container has 80L milk. 20L removed and replaced with water, repeated twice more. Final milk?", a: "33.75L (80×(3/4)³)" },
        { q: "The average of 5 numbers is 20. If one number is excluded, the average becomes 18. Find the excluded number.", a: "28 (5×20 − 4×18)" },
        { q: "Average age of a class of 30 students is 12. If teacher's age (40) is included, new average?", a: "12.9 ((30×12+40)/31)" },
      ],
    },
    {
      id: "ratio-partnership",
      name: "Ratio, Proportion & Partnership",
      questions: [
        { q: "A invests ₹5000 for 12 months, B ₹6000 for 8 months. Profit ratio?", a: "5:4 (60,000:48,000)" },
        { q: "A starts a business with ₹3000. B joins after 4 months with ₹4500. Find the profit ratio at year end.", a: "1:1 (36,000:36,000)" },
        { q: "₹720 is divided among A, B, C in the ratio 2:3:4. Find C's share.", a: "₹320 (4/9 × 720)" },
        { q: "A, B, C invest ₹2000, ₹3000, ₹5000 respectively for the same period. Total profit is ₹2000. Find A's share.", a: "₹400 (2/10 × 2000)" },
        { q: "Two numbers are in ratio 3:5. If 10 is added to each, the ratio becomes 5:7. Find the numbers.", a: "15 and 25" },
        { q: "A sum of ₹1200 is divided among A, B, C such that A gets half of what B and C together get. Find A's share.", a: "₹400 (A = 1/3 of total)" },
        { q: "A invests ₹4000 for the whole year, B invests ₹6000 but withdraws after 6 months. Find the profit ratio.", a: "4:3 (48,000:36,000)" },
      ],
    },
    {
      id: "time-speed-distance",
      name: "Time, Speed & Distance",
      questions: [
        { q: "A boat's speed downstream is 20 km/h and upstream is 12 km/h. Find the boat's speed in still water and the current's speed.", a: "Boat = 16 km/h, current = 4 km/h" },
        { q: "Two trains of length 120m and 180m move toward each other at 40 km/h and 50 km/h. Time to cross each other?", a: "12 seconds (300m at 25 m/s)" },
        { q: "A 150m train crosses a 250m platform in 20s. Speed in km/h?", a: "72 km/h" },
        { q: "A man covers a distance at 40 km/h and returns at 60 km/h. Find his average speed for the whole journey.", a: "48 km/h (2×40×60/(40+60))" },
        { q: "A train 100m long crosses a pole in 10 seconds. Find its speed in km/h.", a: "36 km/h (10 m/s × 18/5)" },
        { q: "Two cars start from the same point in the same direction at 50 km/h and 65 km/h. How far apart are they after 3 hours?", a: "45 km (relative speed 15 km/h × 3h)" },
        { q: "A cyclist covers 15 km in 45 minutes. Find his speed in m/s.", a: "≈5.56 m/s (20 km/h × 5/18)" },
      ],
    },
    {
      id: "time-work",
      name: "Time & Work",
      questions: [
        { q: "A can do a job in 10 days, B in 15 days. How long will they take together?", a: "6 days (LCM=30, combined rate 5/day)" },
        { q: "A is twice as efficient as B. Together they finish a job in 12 days. How long would A alone take?", a: "18 days" },
        { q: "A: 12 days, B: 18 days. They work together 4 days, then A leaves. Days left for B?", a: "8 more days" },
        { q: "A and B together can do a job in 8 days. A alone can do it in 20 days. How long would B alone take?", a: "40/3 days (rate: 1/8 − 1/20 = 3/40)" },
        { q: "3 men or 5 women can do a job in 12 days. How long will 6 men and 5 women take?", a: "3 days (1 man = 5/3 women; total work = 60 woman-days worth 12×5)" },
        { q: "A can finish a job in 15 days. He works for 5 days and leaves. B finishes the rest in 10 days. How long would B alone take for the full job?", a: "15 days (B does 2/3 job in 10 days → full job in 15 days)" },
        { q: "A pipe fills a tank in 6 hours, another empties it in 9 hours. If both are opened together, how long to fill?", a: "18 hours (rate 1/6 − 1/9 = 1/18)" },
      ],
    },
    {
      id: "si-ci",
      name: "Simple & Compound Interest",
      questions: [
        { q: "Find CI − SI on ₹8000 for 2 years at 5% p.a.", a: "₹20 (8000×(5/100)²)" },
        { q: "Find the CI on ₹10,000 for 2 years at 10% p.a., compounded annually.", a: "₹2,100" },
        { q: "₹5000 is invested at 8% p.a. compounded half-yearly for 1 year. Find the amount.", a: "₹5,408" },
        { q: "Find SI on ₹12,000 at 6% p.a. for 3 years.", a: "₹2,160 (12000×6×3/100)" },
        { q: "A sum doubles itself in 8 years at simple interest. Find the rate %.", a: "12.5% (100/8)" },
        { q: "Find CI on ₹15,000 for 3 years at 10% p.a. compounded annually.", a: "₹4,965 (15000×1.1³ − 15000)" },
        { q: "The difference between CI and SI on a sum for 2 years at 10% p.a. is ₹150. Find the sum.", a: "₹15,000 (P×(10/100)²=150)" },
      ],
    },
    {
      id: "number-system",
      name: "Number System",
      questions: [
        { q: "Find the unit digit of 7⁸⁵.", a: "7 (cycle 7,9,3,1; 85 mod 4 = 1)" },
        { q: "Find the unit digit of 3¹⁴⁴.", a: "1 (cycle 3,9,7,1; 144 mod 4 = 0 → position 4)" },
        { q: "HCF of two numbers is 12, LCM is 336. One number is 48. Find the other.", a: "84 (12×336/48)" },
        { q: "Find the unit digit of 8⁹⁹.", a: "2 (cycle 8,4,2,6; 99 mod 4 = 3 → position 3)" },
        { q: "Find the remainder when 2³² is divided by 7.", a: "4 (2³=8≡1 mod 7, so 2³²=2^(3×10+2)≡2²=4)" },
        { q: "What is the largest 4-digit number divisible by 18, 24 and 36?", a: "9936 (LCM=72; largest multiple of 72 ≤9999)" },
        { q: "Find the number of factors of 360.", a: "24 (360=2³×3²×5¹; (3+1)(2+1)(1+1)=24)" },
      ],
    },
    {
      id: "algebra-quadratics",
      name: "Algebra & Quadratic Equations",
      questions: [
        { q: "Roots of x²−7x+k=0 are in ratio 2:5. Find k.", a: "10" },
        { q: "If the sum of the roots of x²−(k+6)x+2k=0 is equal to twice the product of the roots, find k.", a: "k=2" },
        { q: "Factorize and solve: x²−5x+6=0.", a: "x=2 or x=3" },
        { q: "If one root of x²−px+24=0 is 6, find p and the other root.", a: "Other root=4, p=10" },
        { q: "The sum of a number and its reciprocal is 2.5. Find the number.", a: "2 or 0.5 (x²−2.5x+1=0)" },
        { q: "For what value of k does x²+kx+9=0 have equal roots?", a: "k=±6 (discriminant k²−36=0)" },
        { q: "If α, β are roots of x²−5x+6=0, find α²+β².", a: "13 ((α+β)²−2αβ = 25−12)" },
      ],
    },
    {
      id: "geometry-mensuration",
      name: "Geometry & Mensuration",
      questions: [
        { q: "A sphere's radius is doubled. By what factor does volume increase?", a: "8× (volume ∝ r³)" },
        { q: "The side of a cube is tripled. By what factor does its surface area increase?", a: "9× (area ∝ side²)" },
        { q: "A cone has radius 3cm and height 4cm. Find its slant height.", a: "5cm (√(9+16))" },
        { q: "Find the area of a triangle with base 10cm and height 6cm.", a: "30 cm² (½×10×6)" },
        { q: "A cylinder has radius 7cm and height 10cm. Find its volume (use π=22/7).", a: "1540 cm³ (22/7×49×10)" },
        { q: "The area of a circle is 154 cm². Find its radius (use π=22/7).", a: "7cm (154=22/7×r²)" },
        { q: "A rectangle's length is doubled and breadth is halved. What happens to its area?", a: "Area stays the same (2× × ½ = 1×)" },
      ],
    },
    {
      id: "data-interpretation",
      name: "Data Interpretation",
      questions: [
        { q: "A pie chart shows Marketing = 25% of a ₹12,00,000 budget. Marketing's budget?", a: "₹3,00,000 (1/4 of total)" },
        { q: "A bar chart shows sales of 200, 250, 300, 350 units over 4 months. Find the average monthly sales.", a: "275 units" },
        { q: "A pie chart shows Region A=40%, Region B=35%, Region C=25% of total sales of ₹20,00,000. Find Region B's sales.", a: "₹7,00,000" },
        { q: "A pie chart sector spans 72°. What % of the total does it represent?", a: "20% (72/360)" },
        { q: "Sales grew from 400 to 500 units. Find the % growth.", a: "25% ((500−400)/400)" },
        { q: "A table shows 5 years of profit: 10, 12, 15, 14, 18 (in lakhs). Find the year-on-year growth from year 3 to year 4.", a: "−6.67% (14 is a decrease from 15)" },
        { q: "A line graph shows revenue doubling every 2 years starting at ₹5 lakh. Find revenue after 6 years.", a: "₹40 lakh (5×2³)" },
      ],
    },
    {
      id: "reading-comprehension",
      name: "Reading Comprehension",
      questions: [
        { q: "\"Despite the new policy's popularity among employees, several department heads warned it could strain the budget within two years.\" What's the safest inference?", a: "The policy has both support and unresolved financial concerns — no reversal or wrongdoing is stated" },
        { q: "\"Although the committee approved the budget unanimously, several members privately expressed reservations about its long-term sustainability.\" What can be inferred?", a: "Public agreement didn't fully reflect private opinion" },
        { q: "\"Critics argue the reform, while well-intentioned, was implemented too quickly to be properly evaluated.\" What is the critics' main objection?", a: "The pace of implementation, not the intent behind the reform" },
        { q: "\"The study found a correlation between the two variables, though the authors caution against inferring causation.\" What would be a flawed inference from this passage?", a: "Concluding that one variable directly causes the other" },
        { q: "\"Sales rose sharply after the campaign launched, but analysts note the region was already trending upward beforehand.\" What is the passage cautioning against?", a: "Attributing the entire sales rise to the campaign alone" },
      ],
    },
    {
      id: "para-jumbles",
      name: "Para-jumbles",
      questions: [
        { q: "(1) This led to a decline in local employment. (2) The factory closed in 2010 due to rising costs. (3) Workers had to migrate to nearby cities. (4) Government subsidies failed to revive it. Order?", a: "2-4-1-3" },
        { q: "(1) It was later revived by a group of alumni. (2) The school was founded in 1920. (3) By 1990, it had shut down due to lack of funding. (4) Today, it serves over 500 students. Order?", a: "2-3-1-4" },
        { q: "(1) However, this approach proved too costly to sustain. (2) The company initially relied on manual inspection for quality control. (3) It eventually switched to automated systems. (4) These systems cut error rates significantly. Order?", a: "2-1-3-4" },
        { q: "(1) Consequently, several species have started shifting their migratory patterns. (2) Global temperatures have risen steadily over the past decade. (3) Scientists are now tracking these changes closely. (4) This has affected ocean currents worldwide. Order?", a: "2-4-1-3" },
        { q: "(1) They soon realized the estimate had been far too optimistic. (2) The team began the project confident it would finish in three months. (3) Delays piled up as unforeseen issues emerged. (4) The project ultimately took nearly a year. Order?", a: "2-1-3-4" },
      ],
    },
    {
      id: "vocabulary",
      name: "Vocabulary",
      questions: [
        { q: "PRODIGAL is to WASTEFUL as FRUGAL is to ______?", a: "Thrifty (synonym pair)" },
        { q: "Choose the closest synonym for GARRULOUS: (a) shy (b) talkative (c) angry (d) intelligent", a: "(b) talkative" },
        { q: "BENEVOLENT is to MALEVOLENT as OPTIMISTIC is to ______?", a: "Pessimistic (antonym pair)" },
        { q: "Choose the closest synonym for OBSTINATE: (a) flexible (b) stubborn (c) generous (d) cautious", a: "(b) stubborn" },
        { q: "TACITURN is to TALKATIVE as AUDACIOUS is to ______?", a: "Timid (antonym pair)" },
        { q: "Choose the closest synonym for ESOTERIC: (a) obscure (b) popular (c) simple (d) loud", a: "(a) obscure" },
      ],
    },
    {
      id: "grammar",
      name: "Grammar & Sentence Correction",
      questions: [
        { q: "Find the error: \"Each of the students have submitted their assignment.\"", a: "\"Have\" should be \"has\" — subject is \"Each\" (singular)" },
        { q: "Find the error: \"Neither of the answers were correct.\"", a: "\"Were\" should be \"was\" — \"Neither\" is singular" },
        { q: "Find the error: \"The list of items are on the table.\"", a: "\"Are\" should be \"is\" — subject is \"list,\" not \"items\"" },
        { q: "Find the error: \"The team of engineers are working on the fix.\"", a: "\"Are\" should be \"is\" — \"team\" is the (collective, singular) subject" },
        { q: "Find the error: \"One of the biggest reasons for the delay were the weather.\"", a: "\"Were\" should be \"was\" — subject is \"One\" (singular)" },
        { q: "Find the error: \"The number of applicants have increased this year.\"", a: "\"Have\" should be \"has\" — \"The number\" is singular (contrast with \"A number of\")" },
      ],
    },
    {
      id: "seating-arrangement",
      name: "Seating Arrangement & Puzzles",
      questions: [
        { q: "5 people sit in a row. A is immediately left of B. C is at an end. D is exactly in the middle. Where can E sit?", a: "E=2 (with C=1, D=3, A=4, B=5)" },
        { q: "6 people sit around a circular table facing the center. A is second to the right of B. C is immediate left of A. Where is C relative to B?", a: "C is one seat clockwise from B" },
        { q: "4 people sit in a row facing north. P is to the immediate right of Q. R is at one end. S is not adjacent to R. Who is at the other end?", a: "Q or P, depending on which end R occupies — S must be placed so it isn't adjacent to R, forcing the P-Q block away from R's end" },
        { q: "5 friends sit around a circular table facing outward. A is immediate right of B (as seen from outside). Where does A sit relative to B if they instead face the center?", a: "The direction flips — A becomes immediate left of B when facing the center" },
        { q: "In a row, D is 3rd from the left and 3rd from the right. How many people are in the row?", a: "5 (3rd-from-left + 3rd-from-right − 1 = total: 3+3−1=5)" },
      ],
    },
    {
      id: "blood-relations",
      name: "Blood Relations",
      questions: [
        { q: "\"She is the daughter of my grandfather's only son.\" How is she related to Ravi (male, the speaker)?", a: "Ravi's sister" },
        { q: "Pointing to a man, Priya said, \"His mother is the only daughter of my mother.\" How is the man related to Priya?", a: "Priya's son" },
        { q: "\"A is B's brother. C is B's mother. D is C's father.\" How is A related to D?", a: "A is D's grandson" },
        { q: "Pointing to a photograph, a man said, \"She is the mother of my son's wife's daughter.\" Who is she to the man?", a: "His son's mother-in-law" },
        { q: "\"X's father is Y's son. Y has no other son.\" How is X related to Y?", a: "X is Y's grandchild" },
      ],
    },
    {
      id: "syllogisms",
      name: "Syllogisms",
      questions: [
        { q: "All cats are animals. Some animals are dogs. → Some cats are dogs. Valid?", a: "Invalid — the dog circle can avoid the cat circle entirely" },
        { q: "All roses are flowers. No flower is a weed. Conclusion: No rose is a weed. Valid?", a: "Valid — roses are inside flowers, which never overlap weeds" },
        { q: "Some pens are books. All books are papers. Conclusion: Some pens are papers. Valid?", a: "Valid — the overlapping pens must fall inside the books circle, which is inside papers" },
        { q: "No boy is a girl. Some girls are students. Conclusion: No boy is a student. Valid?", a: "Invalid — boys and students can still overlap despite boys and girls being separate" },
        { q: "All squares are rectangles. All rectangles are quadrilaterals. Conclusion: All squares are quadrilaterals. Valid?", a: "Valid — nested \"All A are B, All B are C\" always gives \"All A are C\"" },
      ],
    },
    {
      id: "coding-decoding",
      name: "Coding-Decoding",
      questions: [
        { q: "If CAT is coded as DBU, how is DOG coded?", a: "EPH (each letter +1)" },
        { q: "If FLOWER is coded as EKNVDQ, how is GARDEN coded?", a: "FZQCDM (each letter −1)" },
        { q: "If PAPER is coded as QCSIW (each letter shifted by +1, +2, +3, +4, +5 respectively), how is BOOK coded using the same rule?", a: "CQRO (B+1=C, O+2=Q, O+3=R, K+4=O)" },
        { q: "In a code, MONKEY is written as XPMLZN (reverse the word, then each letter +1). How is TIGER coded?", a: "SFHJU (reverse TIGER→REGIT, then each letter +1)" },
        { q: "If in a certain code, 'RAIN' is written as 'IRNA' (swap 1st↔2nd, 3rd↔4th), how is 'SNOW' written?", a: "NSWO" },
      ],
    },
    {
      id: "number-series",
      name: "Number & Letter Series",
      questions: [
        { q: "2, 3, 5, 8, 13, ___", a: "21 (each term = sum of previous two)" },
        { q: "Find the next term: 1, 4, 9, 16, 25, ___", a: "36 (perfect squares)" },
        { q: "Find the next term: 3, 6, 11, 18, 27, ___", a: "38 (differences 3,5,7,9,11 — increasing by 2)" },
        { q: "Find the next term: 5, 10, 20, 40, ___", a: "80 (constant ratio ×2)" },
        { q: "Find the next term: 1, 2, 4, 7, 11, 16, ___", a: "22 (differences 1,2,3,4,5,6 — difference-of-differences is constant)" },
        { q: "Find the missing term: 2, 5, 10, 17, 26, ___", a: "37 (n²+1 pattern: 1²+1, 2²+1, 3²+1... → 6²+1=37)" },
      ],
    },
  ];

  function getTopic(id) {
    return topics.find((t) => t.id === id);
  }

  // ---- SHARED NAV/AUTH UI --------------------------------------------
  function mountAuthControl(onSignedInChange) {
    const nav = document.querySelector(".topnav");
    if (!nav) return;
    const el = document.createElement("span");
    el.className = "auth-control";
    nav.appendChild(el);

    function render(signedIn) {
      el.innerHTML = "";
      const btn = document.createElement("button");
      btn.className = "auth-btn";
      btn.textContent = signedIn ? "Sign out" : "Sign in to sync";
      btn.onclick = signedIn ? signOut : signIn;
      el.appendChild(btn);
      if (onSignedInChange) onSignedInChange(signedIn);
    }

    initAuth(render);
    render(isSignedIn());
  }

  return {
    initAuth, signIn, signOut, isSignedIn,
    loadData, saveData, emptyData,
    computeMastery, MASTERY_MIN_QUESTIONS, MASTERY_MIN_ACCURACY,
    topics, getTopic,
    mountAuthControl,
  };
})();


let LEETCODE_API_ENDPOINT = "https://leetcode.com/graphql";
let LEETCODE_GRAPHQL_QUERY = `
query globalData {
  streakCounter {
    currentDayCompleted
  }
  userStatus {
    isSignedIn
    username
  }
  activeDailyCodingChallengeQuestion {
    link
  }
}
`;
let LEETCODE_ALL_PROBLEMS_QUERY = `
query userSessionProgress($username: String!) {
  matchedUser(username: $username) {
    submitStats {
      acSubmissionNum {
        difficulty
        count
        submissions
      }
    }
  }
}
`;

let LEETCODE_NEW_UI_QUERY = `query enableNewStudyPlan {
    feature {
        enableNewStudyPlan}
    }
`;

// this function will retry for 3 times if any error occur while fetching the leetcode graphql
let getLeetCodeData = async (query, variables) => {
    let retriesLeft = 3;
    while (retriesLeft > 0) {
        try {
            const init = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, variables }),
            };

            const response = await fetch(LEETCODE_API_ENDPOINT, init);

            if (response.ok) {
                return response.json();
            }
        } catch (error) {
            console.error(`Error: ${error}. Retrying...`);
            retriesLeft--;
        }
    }

    console.error("Failed to call API after 3 retries.");
};

function redirect(path = "/") {
    chrome.tabs.query(
        { currentWindow: true, active: true },
        (tabs) => {
            try {
                const currURL = new URL(tabs[0].url);
                const domain = currURL.hostname;

                if (!domainWhiteList.has(domain)) {
                    chrome.tabs.update({ url: `http://leetcode.com${path}` });
                }
            } catch (error) {
                return;
            }
        }
    );
}

async function checkForNewCompletion(data) {
    const problemsData = await getLeetCodeData(LEETCODE_ALL_PROBLEMS_QUERY,
        { username: data.userStatus.username });
    const numSubmissions = problemsData.data.matchedUser.submitStats.acSubmissionNum[0].submissions;
    const prevSubmissions = localStorage.getItem('numSubmissions');

    if (prevSubmissions.numSubmissions !== undefined
        && prevSubmissions.numSubmissions < numSubmissions) {
        localStorage.setItem({
            todayDateAfterChallenegeComplete: new Date().toDateString(),
            numSubmissions: numSubmissions
        });

        // if today's challenge is completed save today's date and use it if user is signed out
        return;
    }
    console.log(localStorage.getItem('numSubmissions'));
    redirect("/problemset/all/")
}

const domainWhiteList = new Set(["leetcode.com", "accounts.google.com", "extensions", "github.com", "drive.google.com"]); // this set is to whitelist the redirection for chrome://extensions and accounts.google.com
function checkForTodaysChallenge(data) {
    if (data.streakCounter.currentDayCompleted) {
        chrome.storage.local.set({ utcDateStoredForDaily: new Date().getUTCDate() });
        // if today's challenge is completed save today's date in UTC (leetcode daily problem is changed according to UTC) and use it if user is signed out
        return;
    }
    redirect(data.activeDailyCodingChallengeQuestion.link);
    // if signed in and current day is not completed redirect to leetcode daily challenge problem
}
function sleep(ms) { // this function will stop the code for input milli sec.
    return new Promise(resolve => setTimeout(resolve, ms));
}
// this function will redirect to leetcode.com
async function leetcodeForcer() {
    getLeetCodeData(LEETCODE_GRAPHQL_QUERY)
        .then(async (data) => {
            if (!data || !data.data) {
                throw new Error("No data received.");
            }

            data = data.data

            if (data.userStatus.isSignedIn) {
                const mode = await chrome.storage.local.get('mode');
                if (mode.mode === "daily") {
                    checkForTodaysChallenge(data);
                } else {

                    const problemsData = await getLeetCodeData(LEETCODE_ALL_PROBLEMS_QUERY, { username: data.userStatus.username });
                    const numSubmissions = problemsData.data.matchedUser.submitStats.acSubmissionNum[0].submissions;
                    chrome.storage.local.set({
                        numSubmissions: numSubmissions
                    });
                    redirect(links[[Math.floor(Math.random() * links.length)]]);
                    await sleep(3000); // taking 2 sec break so that the leetcode graph ql can update with latest submissions.
                    checkForNewCompletion(data);
                }
            } else { //If user is not signed in, redirect to leetcode.com for login
                redirect()
            }
        })
        .catch( // some error occurs while doing leetcode forcing catch and log in console
            error => console.error("Error while doing leetcode forcing ," + error)
        );
}
getLeetCodeData(LEETCODE_NEW_UI_QUERY).then(
    async (data) => {
        if (!data || !data.data) {
            throw new Error("No data received.");
        }
        console.log(data);
    }
);
/**
 * this function will check if day has been changed or not
 *
 * @returns {Promise<boolean>} true if day has been changed else false
 */
async function isAlreadySolved() {
    let items = await chrome.storage.local.get('todayDateAfterChallenegeComplete');
    let utcDateStoredForDaily = await chrome.storage.local.get('utcDateStoredForDaily');
    let mode = await chrome.storage.local.get('mode');

    const lastSolvedDay = items.todayDateAfterChallenegeComplete;
    const todayDate = new Date();

    if (mode.mode !== undefined && mode.mode === "daily") { // here we are maintaining the sync between timezones for daily leetcode problem as daily problem changes according to UTC timezone
        const lastSolvedDateForDailyInUtc = utcDateStoredForDaily.utcDateStoredForDaily;
        const todayDateInUtc = new Date().getUTCDate();
        return (lastSolvedDateForDailyInUtc !== undefined && lastSolvedDateForDailyInUtc === todayDateInUtc);
    }

    return (lastSolvedDay !== undefined && new Date(lastSolvedDay).getDate() === todayDate.getDate());
}

// this function will handle the emergency button functionality
async function emergencyButtonHandle() {

    if (await isAlreadySolved()) {
        return;
    }

    const items = await chrome.storage.local.get('storedTime');
    if (items.storedTime) {
        // emergency button is clicked make sure that if current time is 3 hours more than
        // last stored time (time when someone clicked the button)
        // then leetcode forcing will start; else do nothing
        const lastStoredDate = new Date(items.storedTime);
        const currentTime = new Date();
        const diffTime = lastStoredDate - currentTime;

        if (diffTime <= 0) {
            chrome.storage.local.remove("storedTime"); // removing the stored time as now it's work is done, so if someone again open or update the tab storedTime will become undefined and this function will go to leetcodeForcer()
            leetcodeForcer();
        }
    } else {
        // emergency button is not clicked yet
        leetcodeForcer();
    }
}

// this chrome api works when someone updated the tab
chrome.tabs.onUpdated.addListener(function (tabId, tabInfo, tab) {
    // to call only once. No need for this in onActivated as that api call once by default
    if (tab.url !== undefined && tabInfo.status === "complete") {
        //onUpdated renders multiple time due to iframe tags 
        //so to only do leetcode forcing once check tab status is completed or not
        emergencyButtonHandle();
    }
});

//this chrome api works when tab will become activated e.g. when someone creates new tab
chrome.tabs.onActivated.addListener(function () {
    emergencyButtonHandle();
});






// problem links
const links = [
    "/problems/two-sum/",
    "/problems/best-time-to-buy-and-sell-stock/",
    "/problems/contains-duplicate/",
    "/problems/product-of-array-except-self/",
    "/problems/maximum-subarray/",
    "/problems/maximum-product-subarray/",
    "/problems/find-minimum-in-rotated-sorted-array/",
    "/problems/search-in-rotated-sorted-array/",
    "/problems/3sum/",
    "/problems/container-with-most-water/",
    "/problems/reverse-linked-list/",
    "/problems/linked-list-cycle/",
    "/problems/merge-two-sorted-lists/",
    "/problems/remove-nth-node-from-end-of-list/",
    "/problems/reorder-list/",
    "/problems/valid-parentheses/",
    "/problems/implement-queue-using-stacks/",
    "/problems/min-stack/",
    "/problems/evaluate-reverse-polish-notation/",
    "/problems/generate-parentheses/",
    "/problems/longest-substring-without-repeating-characters/",
    "/problems/longest-palindromic-substring/",
    "/problems/valid-anagram/",
    "/problems/group-anagrams/",
    "/problems/implement-strstr/",
    "/problems/maximum-depth-of-binary-tree/",
    "/problems/same-tree/",
    "/problems/invert-binary-tree/",
    "/problems/binary-tree-maximum-path-sum/",
    "/problems/binary-tree-level-order-traversal/",
    "/problems/serialize-and-deserialize-binary-tree/",
    "/problems/subtree-of-another-tree/",
    "/problems/construct-binary-tree-from-preorder-and-inorder-traversal/",
    "/problems/validate-binary-search-tree/",
    "/problems/kth-smallest-element-in-a-bst/",
    "/problems/clone-graph/",
    "/problems/course-schedule/",
    "/problems/number-of-islands/",
    "/problems/graph-valid-tree/",
    "/problems/word-ladder/",
    "/problems/climbing-stairs/",
    "/problems/coin-change/",
    "/problems/longest-increasing-subsequence/",
    "/problems/longest-common-subsequence/",
    "/problems/word-break/",
    "/problems/combination-sum/",
    "/problems/house-robber/",
    "/problems/house-robber-ii/",
    "/problems/decode-ways/",
    "/problems/unique-paths/",
    "/problems/subsets/",
    "/problems/subsets-ii/",
    "/problems/permutations/",
    "/problems/permutations-ii/",
    "/problems/combination-sum-ii/",
    "/problems/palindrome-partitioning/",
    "/problems/letter-combinations-of-a-phone-number/",
    "/problems/generate-parentheses/",
    "/problems/n-queens/",
    "/problems/sudoku-solver/",
    "/problems/binary-search/",
    "/problems/search-insert-position/",
    "/problems/first-bad-version/",
    "/problems/find-peak-element/",
    "/problems/search-in-rotated-sorted-array-ii/",
    "/problems/minimum-window-substring/",
    "/problems/sliding-window-maximum/",
    "/problems/longest-substring-with-at-most-two-distinct-characters/",
    "/problems/permutation-in-string/",
    "/problems/find-all-anagrams-in-a-string/",
    "/problems/jump-game/",
    "/problems/jump-game-ii/",
    "/problems/gas-station/",
    "/problems/candy/",
    "/problems/assign-cookies/",
    "/problems/powx-n/",
    "/problems/sqrtx/",
    "/problems/divide-two-integers/",
    "/problems/happy-number/",
    "/problems/factorial-trailing-zeroes/",
    "/problems/single-number/",
    "/problems/number-of-1-bits/",
    "/problems/counting-bits/",
    "/problems/missing-number/",
    "/problems/sum-of-two-integers/",
    "/problems/lru-cache/",
    "/problems/lfu-cache/",
    "/problems/design-hashmap/",
    "/problems/find-median-from-data-stream/",
    "/problems/design-tic-tac-toe/",
    "/problems/shortest-path-in-binary-matrix/",
    "/problems/surrounded-regions/",
    "/problems/word-search/",
    "/problems/unique-paths-iii/",
    "/problems/pacific-atlantic-water-flow/",
    "/problems/swim-in-rising-water/",
    "/problems/network-delay-time/",
    "/problems/path-with-minimum-effort/",
    "/problems/escape-a-large-maze/",
    "/problems/minimum-cost-to-make-at-least-one-valid-path-in-a-grid/",
    "/problems/alien-dictionary/",
    "/problems/course-schedule-ii/",
    "/problems/reconstruct-itinerary/",
    "/problems/sequence-reconstruction/",
    "/problems/parallel-courses/",
    "/problems/implement-trie-prefix-tree/",
    "/problems/add-and-search-word-data-structure-design/",
    "/problems/word-search-ii/",
    "/problems/replace-words/",
    "/problems/maximum-xor-of-two-numbers-in-an-array/",
    "/problems/range-sum-query-immutable/",
    "/problems/range-sum-query-mutable/",
    "/problems/range-sum-query-2d-immutable/",
    "/problems/range-sum-query-2d-mutable/",
    "/problems/the-skyline-problem/",
    "/problems/trapping-rain-water/",
    "/problems/largest-rectangle-in-histogram/",
    "/problems/maximal-rectangle/",
    "/problems/daily-temperatures/",
    "/problems/next-greater-element-i/",
    "/problems/count-of-smaller-numbers-after-self/",
    "/problems/reverse-pairs/",
    "/problems/range-sum-query-immutable/",
    "/problems/range-sum-query-mutable/",
    "/problems/range-sum-query-2d-immutable/",
    "/problems/design-circular-queue/",
    "/problems/design-circular-deque/",
    "/problems/design-snake-game/",
    "/problems/design-tic-tac-toe/",
    "/problems/design-hit-counter/",
    "/problems/combine-two-tables/",
    "/problems/second-highest-salary/",
    "/problems/nth-highest-salary/",
    "/problems/rank-scores/",
    "/problems/dense-rank/",
    "/problems/binary-tree-inorder-traversal/",
    "/problems/binary-tree-preorder-traversal/",
    "/problems/binary-tree-postorder-traversal/",
    "/problems/binary-tree-paths/",
    "/problems/sum-root-to-leaf-numbers/"
];
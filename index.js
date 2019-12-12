require('dotenv').config();
const fetch = require('node-fetch');
const to = require('await-to-js').default;
const moment = require('moment');
const Twitter = require('twitter');
const fs = require('fs');
const util = require('util');

// commons is cafe ID 224
// set up URL for getting today's menu
const cafeID = 224;
const url = new URL('https://legacy.cafebonappetit.com/api/2/menus');
url.search = `cafe=${cafeID}`;

const twitter = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

// use fs to keep track of what meals we have tweeted already
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const lastMealFilename = './lastmealposted.json';

const fetchMenuData = async () => {
  // fetch menu data
  const [err, resRaw] = await to(fetch(url));
  if (err) return (err.message);
  // parse into JSON
  const [parsingErr, data] = await to(resRaw.json());
  if (parsingErr) return (parsingErr.message);
  return data;
};

// check to see if we are near a meal (<1hr)
const checkNearMeal = (cafe) => {
  const dayParts = cafe.dayparts[0];
  // parse start and end times
  const parsedParts = dayParts.map((p, i) => {
    const start = moment(p.starttime, 'HH:mm');
    const end = moment(p.endtime, 'HH:mm');
    return { start, end, index: i };
  });
  // check to see if we are 1 hour away from a meal
  const closeToMeal = parsedParts.map((p) => {
    const now = moment();
    const { start } = p;
    // past 1 hour before meal starts
    const withinAnHour = start.subtract(1, 'hour').isBefore(now);
    // meal hasnt started yet
    const hasntStartedYet = start.add(1, 'hour').isAfter(now);
    if (withinAnHour && hasntStartedYet) return true;
    return false;
  });
  const nextNearMealIndex = closeToMeal.indexOf(true);
  // if there's no meal in < 1hr, don't do anything
  if (nextNearMealIndex === -1) return false;
  // index of which meal is in an hour w/in dayParts array
  const nextNearMeal = dayParts[nextNearMealIndex];
  return nextNearMeal;
};

// go through each station and get tier 1 items
const getMealItems = (nextNearMeal, data) => {
  const nextMealWithItems = nextNearMeal.stations.map((m) => {
    const { items, label: stationLabel } = m;
    // get item data using the keys included in the station items
    const thisStationItems = items.map((i) => data.items[i]);
    // filter out tier 1 items (the big ones, exclude things like sugar and pickles)
    const tier1Items = thisStationItems.filter((i) => {
      // if item does not contain a tier key, don't include in list
      if ('tier' in i === false) return false;
      // if item has 1 as tier, include in list
      if (i.tier === 1) return true;
      // if item has something other than 1 in tier, don't include in list
      return false;
    });
    // just get item name, description and labels (eg vegan, veg)
    const itemData = tier1Items.map(
      ({
        label,
        description,
        cor_icon, // eslint-disable-line camelcase
      }) => {
        // parse out veg, vegan, gluten free
        const noticeNumbers = Object.keys(cor_icon).filter(
          (i) => [1, 4, 9].indexOf(parseInt(i, 10)) > -1,
        );
        // convert numbers to labels
        const notices = noticeNumbers.map((n) => {
          switch (n) {
            case ('1'): { return 'veg'; }
            case ('4'): { return 'vegan'; }
            case ('9'): { return 'gf'; }
            default: { return null; }
          }
        });
        return ({
          label,
          description,
          notices,
        });
      },
    );
    const stationWithItems = { label: stationLabel, items: itemData };
    return stationWithItems;
  });
  return nextMealWithItems;
};

// delay function to add delay between each tweet to allow for previous tweet to propagate
// through twitter databases
const delay = (time) => new Promise((res) => setTimeout(() => res(), time));

const makeTweets = async (index, tweetTexts, lastTweetID) => {
  console.log({ index, lastTweetID});
  let err = null;
  let msg = {};
  // first tweet is not in reply to anything so we cant provide an in_reply_to_status_id value
  if (index === 0) {
    [err, msg] = await to(twitter.post('statuses/update', { status: tweetTexts[index] }));
  } else {
    // the rest of the tweets are in reply to each other so that the meal will be in a thread
    [err, msg] = await to(twitter.post(
      'statuses/update',
      {
        status: `${tweetTexts[index]}`,
        username: '@reedcommonsmenu',
        in_reply_to_status_id: lastTweetID,
      },
    ));
  }
  if (err) console.error('twitter error:', err);
  else console.log({ tweeted: msg.text, id: msg.id_str });
  // await delay(1000);
  if (tweetTexts.length - 1 > index) return makeTweets(index + 1, tweetTexts, msg.id_str);
  return true;
};

const stationEmoji = {
  Toast: '🍞',
  'Breakfast Grill': '🍳',
  'Salad Bar Breakfast': '🥗',
  'Breakfast Cocina': '🌯',
  'Deli Breakfast': '🥯',
  'Daily Planet Breakfast': '🥓',
  'Daily Planet Lunch': '🍲',
  Taqueria: '🌮',
  'Classics Delicatessen': '🥪',
  Ovens: '🍕',
  Grill: '🍔',
  'Lighten up at the Grill': '🥬',
  DIY: '🍝',
  Beverage: '🧃',
  Simmered: '🍜',
  Cereal: '🥣',
};

// wrap in function so we can use async/await
const main = async () => {
  // check to see if lastmealposted.json exists, create if it does not
  const [lastMealPostedDoesNotExist] = await to(readFile(lastMealFilename));
  if (lastMealPostedDoesNotExist) {
    await writeFile(
      lastMealFilename, JSON.stringify({ lastMealPosted: null }),
    );
  }

  // fetch menu data from BA API
  const data = await fetchMenuData();
  // menu is stored in parts of the day
  const cafe = data.days[0].cafes[cafeID];
  // check to see if we are near a meal (<1hr)
  const nextNearMeal = checkNearMeal(cafe);
  if (nextNearMeal === false) {
    console.log('no new upcoming meals');
    return true;
  }
  // go through each station and get tier 1 items
  const nextMealWithItems = getMealItems(nextNearMeal, data);
  // filter out stations that aren't serving any items (ie stations from other meals)
  const nextMeal = nextMealWithItems.filter((s) => s.items.length > 0);
  // get the name of the meal
  const nextMealName = nextNearMeal.label;
  // convert each station into a string
  const stationStrings = nextMeal.map((s) => {
    const stationName = s.label;
    const items = s.items.map(({ label, notices }) => `${label} ${notices.length ? `(${notices.join(' ')})` : ''}`);
    // add emojis to the station names becase we have fun here
    const stationString = `${(stationName in stationEmoji ? `${stationEmoji[stationName]} ` : '')}${stationName}\n${items.join('\n')}`;
    return stationString;
  });
  // make array of tweet texts
  const tweets = [`Reed College Commons ${nextMealName} ${moment().format('MMM Do YYYY')}`].concat(stationStrings);
  // if it's hot turkey sandwich day, make a BIG DEAL ABOUT IT!!!
  const isHotTurkeySandwichDay = stationStrings.some(
    (text) => /Hot Turkey or Vegan Field Roast Sandwich/.test(text),
  );
  if (isHotTurkeySandwichDay) {
    tweets[0] = `Reed College Commons ${nextMealName} ${moment().format('MMM Do YYYY')}. By the way it is HOT TURKEY SANDWICH DAY 🔥🦃🥪`;
  }

  // check lastmealposted.json to make sure we haven't posted this meal
  const lastMealRaw = await readFile(lastMealFilename);
  const { lastMealPosted } = JSON.parse(lastMealRaw);
  if (lastMealPosted !== nextMealName) {
    console.log(`now tweeting ${nextMealName} menu`);
    // recursively tweet since we want each tweet to be a reply
    // to the previous one so that each meal will be one thread
    await makeTweets(0, tweets);
    await writeFile(lastMealFilename,
      JSON.stringify({ lastMealPosted: nextMealName }));
  } else { console.log(`already tweeted ${nextMealName}`); }
  return true;
};

// run once a minute
const interval = 60000;
main();
setInterval(main, interval);

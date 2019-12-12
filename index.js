const fetch = require('node-fetch');
const to = require('await-to-js').default;
const moment = require('moment');

// commons is cafe ID 224
// set up URL for getting today's menu
const cafeID = 224;
const url = new URL('https://legacy.cafebonappetit.com/api/2/menus');
url.search = `cafe=${cafeID}`;

const fetchMenuData = async () => {
  // fetch menu data
  const [err, resRaw] = await to(fetch(url));
  if (err) return (err.message);
  // parse into JSON
  const [parsingErr, data] = await to(resRaw.json());
  if (parsingErr) return (parsingErr.message);
  return data;
};

// wrap in function so we can use async/await
const main = async () => {
  const data = await fetchMenuData();
  // menu is stored in parts of the day
  const dayParts = data.days[0].cafes[224].dayparts[0];
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
  const nextNearMeal = dayParts[2];
  console.log(nextNearMeal);
};

main();

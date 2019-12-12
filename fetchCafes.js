const fetch = require('node-fetch');
const to = require('await-to-js').default;

// make array of numbers since each cafe id is just a sequential number starting at 0
const cafeNumbers = Array.from(Array(25).keys());

const main = async () => {
  const cafeData = await Promise.all(cafeNumbers.map(async (v) => {
    v = v + 200
    const url = new URL('https://legacy.cafebonappetit.com/api/2/menus');
    url.search = `cafe=${v}`;
    const [err, resRaw] = await to(fetch(url));
    if (err) return (err.message);
    const [parsingErr, data] = await to(resRaw.json());
    if (parsingErr) return (parsingErr.message);
    return ({
      id: v,
      name: data.days[0].cafes[v].name
    });
  }));

  console.log(cafeData);
};

main();

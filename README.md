# trackz

A simple local finance tracker built with `Express` and static frontend files. Data is stored in JSON under `data/`, so you can run everything offline on your machine.

## Improvements included

- dashboard cards for balances, monthly income, monthly expenses, and EUR net worth
- fixed account balance math so expenses reduce balances and transfers move money correctly
- transfer support with source and destination accounts
- server-side validation for accounts and transactions
- transaction filters, delete action, empty states, and cleaner feedback messages
- improved responsive UI styling

## Run locally

```sh
npm install
npm start
```

Then open `http://localhost:3000`.

## Notes

- the app still uses local JSON files in `data/`
- EUR conversion uses `data/currency-rate.json`
- if a currency has no EUR rate, its EUR equivalent is shown as unavailable
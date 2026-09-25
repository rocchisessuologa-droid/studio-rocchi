# Studio Rocchi — beta 10 · consenso informato online

Questo pacchetto mantiene le funzioni della beta 9 e aggiunge il consenso informato online con link personale, monouso e a scadenza. La pubblicazione precedente non viene modificata finché non carichi questi file su GitHub/Vercel.

## 1. Attiva l’archivio online

1. Crea un progetto Supabase dedicato su https://supabase.com/dashboard. Scegli una regione europea e conserva la password del database.
2. Apri SQL Editor e incolla tutto il file `schema.sql`. Su un progetto nuovo eseguilo integralmente. Se stai aggiornando la beta 9, puoi eseguirlo di nuovo: usa `create table if not exists`/`create or replace` e aggiunge la tabella `consent_links` necessaria ai link online.
3. In Authentication → Users crea il tuo utente amministratore con email e password forte. Conferma l’email tramite il comando amministrativo e copia il suo UUID.
4. Esegui questa istruzione nel SQL Editor, sostituendo UUID ed email:

```sql
insert into public.staff(id,email,role,active)
values ('UUID_UTENTE','TUA_EMAIL','admin',true);
```

5. Disabilita le registrazioni pubbliche nelle impostazioni Authentication. Gli account successivi si creano esclusivamente nella sezione Accessi del gestionale.
6. Nelle impostazioni API copia Project URL e la chiave legacy `service_role`. Questa chiave deve stare SOLO nelle variabili server di Vercel, mai in app.js, in un file caricato nel repository o nei messaggi.

## 2. Aggiorna Vercel

1. Nel repository già collegato a Vercel, carica il contenuto dello ZIP nella cartella principale: `index.html`, `style.css`, `app.js`, le cartelle `assets`, `vendor`, `api`, e `package.json`, `vercel.json`. Mantieni le cartelle esattamente come sono.
2. Non caricare un file `.env` con credenziali. `.env.example` contiene solo esempi.
3. Nel progetto Vercel apri Settings → Environment Variables. Aggiungi `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `CALENDAR_WEBHOOK_SECRET` (una stringa casuale di almeno 32 caratteri). Configurale nell’ambiente Production.
4. Framework Preset: Other. Non serve un comando di build; la cartella di output è la radice del progetto. La cartella `api` contiene la funzione server Vercel.
5. Avvia un nuovo deploy e apri il sito HTTPS. Accedi con l’utente creato al punto 1.
6. In Accessi crea gli operatori o altri amministratori. La password iniziale richiede almeno 12 caratteri. Puoi disabilitare un utente, cambiarne il ruolo e reimpostarne la password. Non puoi disabilitare il tuo stesso accesso.

Amministratori e operatori possono lavorare sull’intero archivio dello studio. Solo gli amministratori gestiscono gli accessi. Non sono previsti archivi separati per singolo operatore. Le sessioni scadono dopo circa un’ora e richiedono un nuovo accesso.

La demo è separata dai dati online: usa solo dati temporanei e fittizi in memoria. Non salva pazienti nel browser. Non offre upload o creazione di utenti reali.

## 3. Calendario Apple / iCal e Zapier

Prima identifica l’account: apri Calendario Apple e controlla se il calendario è sotto iCloud, Google oppure Outlook. L’app Apple e l’account che contiene gli eventi sono due cose diverse.

### Se il calendario Apple usa Google

1. Accedi a https://zapier.com/app/zaps e crea uno Zap.
2. Trigger: Google Calendar → New or Updated Event. Collega l’account Google e scegli il calendario corretto.
3. Testa il trigger usando un evento fittizio chiamato “Occupato”.
4. Azione: Webhooks by Zapier → POST. Questa funzione può richiedere un piano Zapier a pagamento: verifica nell’account prima di attivarlo.
5. URL: `https://TUO-SITO.vercel.app/api/app?action=calendar-hook`.
6. Payload Type: JSON. Intestazione `Authorization` con valore `Bearer SEGRETO`, dove SEGRETO è lo stesso valore di CALENDAR_WEBHOOK_SECRET impostato in Vercel.
7. Mappa i campi:

| Campo del gestionale | Valore Zapier |
| --- | --- |
| externalId | ID stabile dell’evento Google |
| title | Testo neutro, per esempio Occupato |
| start | Inizio ISO 8601 con fuso orario, es. 2026-10-01T09:00:00+02:00 |
| end | Fine ISO 8601 con fuso orario |
| cancelled | false, booleano JSON |

8. Per gli eventi di giornata intera, usa mezzanotte del giorno iniziale e mezzanotte del giorno successivo nel fuso Europe/Rome. Per le ricorrenze invia ogni singola istanza con un ID distinto e stabile.
9. Esegui il test POST. Una risposta `ok: true` indica il salvataggio. Se compare un conflitto orario, risolvi il conflitto nel gestionale e riprova lo Zap.
10. Pubblica lo Zap. Nel gestionale premi Sincronizza e verifica l’evento.
11. Configura un secondo Zap con il trigger di cancellazione dell’evento Google. Invia externalId, start, end e `cancelled: true` (booleano). Verifica la disponibilità di quel trigger nel tuo account. Senza questo secondo flusso le cancellazioni non arrivano al gestionale.

Gli eventi entrano come impegni personali, senza creare pazienti o incassi. Gli aggiornamenti dello stesso externalId non duplicano l’evento. I titoli dovrebbero restare neutri per evitare il trasferimento di dettagli clinici.

### Se il calendario è nativamente iCloud

Non è stato attivato né verificato un connettore diretto iCloud → Zapier. Prima di procedere va scelto un ponte compatibile con quell’account oppure l’utilizzo di un calendario Google nell’app Apple. Non pubblicare un calendario contenente pazienti per ottenere un URL iCal pubblico. Il pulsante Esporta iCal produce un file .ics anonimo importabile in Apple, ma non realizza una sincronizzazione automatica.

### Cosa fa Sincronizza

Ricarica tutti i dati già salvati nell’archivio online, compresi gli eventi ricevuti da Zapier. Non forza Zapier a interrogare Google o iCloud e non annulla i tempi del trigger. Il flusso predisposto è in ingresso calendario → gestionale; non è una sincronizzazione bidirezionale. Non è stato eseguito un test con i tuoi account.

## Utilizzo

- Agenda: vista giorno/settimana/mese; passaggio sulle date per anteprima; impegni personali per fascia o giornata; controllo delle sovrapposizioni sul server. L’agenda è unica per lo studio, anche con più operatori.
- Appuntamento ricorrente: ripetizione ogni 1, 2 o 4 settimane fino a una data, massimo 100 ricorrenze. Se una ricorrenza collide, l’intera operazione online viene annullata.
- Pagamento: Da saldare come valore iniziale. Saldato richiede metodo e data incasso. Fattura, numero, importo e saldo fattura sono registrazioni manuali, non emissione fiscale.
- Storico: recupera automaticamente gli appuntamenti passati collegati all’ID paziente; la spunta Visita eseguita conferma lo svolgimento. Non ricostruisce visite mai inserite nel gestionale.
- Coppie: collegamento reciproco con paziente esistente oppure nuova anagrafica partner. Gli appuntamenti sono collegati al paziente selezionato.
- Allegati: upload privato di immagini, PDF, Word, Excel, testo e ODT fino a 3 MB ciascuno. Download autorizzato tramite collegamento che scade dopo 60 secondi.
- Pazienti XLS: esportazione Excel .xls reale, importazione .xls e .xlsx. Esporta un elenco anche vuoto per ottenere le intestazioni. L’importazione mostra un’anteprima da confermare e gestisce al massimo 500 righe. Il codice fiscale o l’ID identificano una scheda esistente. Le date devono essere celle data Excel o testo ISO AAAA-MM-GG.
- Pagamenti: incassi raggruppati per data di pagamento, dovuto per data visita. Filtri Lazzari, Frigieri, Parma, Modena, Online. Le categorie possono sovrapporsi e non vanno sommate.
- Promemoria: la spunta archivia; nell’archivio il testo è barrato, con selezione multipla ed eliminazione da confermare.

## Verifiche e limiti

Sono passati sei test automatici: validazione appuntamenti, autorizzazione dei ruoli, protezione del webhook, flussi di dati della demo e lettura/scrittura XLS. La verifica visiva in un browser non è stata completata perché il browser di test non era disponibile. I collegamenti reali con Supabase, Vercel, Storage e Zapier richiedono la configurazione descritta e un collaudo online prima di utilizzare dati di pazienti. Prima dell’uso reale, verifica anche backup, gestione della conservazione, accordi con i fornitori e permessi appropriati all’attività clinica. Non è una certificazione di conformità del gestionale.

Messaggi, Statistiche e Risorse restano le sezioni non operative della beta precedente. Non sono state richieste in questo aggiornamento.

Riferimenti: https://supabase.com/docs/guides/auth/passwords — https://zapier.com/apps/google-calendar/integrations — https://support.apple.com/guide/calendar/welcome/mac

Sviluppo locale: Node 22 o successivo; `node --env-file=.env server.mjs` con credenziali server, oppure `npm start` per esplorare la demo. Il server locale non sostituisce l’hosting HTTPS.

## Consenso firmato a penna (beta 9)

Nella scheda del paziente usa **Carica consenso con firma autografa**. Carica il PDF ricevuto, indica la data e il canale di ricezione. Il documento compare nella scheda e nella sezione Documenti, con impronta SHA-256 e data di caricamento registrata dal server. La vecchia spunta manuale, se esiste, è mostrata come indicazione precedente senza documento e non equivale a un PDF acquisito.

Il PDF scansionato è una copia del modulo con firma autografa, non una firma digitale. Conserva separatamente l'eventuale originale cartaceo e il messaggio originale di trasmissione; verifica identità e completezza del modulo prima di caricarlo. Se il file non è leggibile o contiene pagine mancanti, richiedi una nuova copia. I documenti caricati restano nell'archivio privato `patient-files`, accessibili solo agli utenti abilitati del gestionale. La firma e la validità dei contenuti non sono verificate automaticamente dal software.

**Prima di inserire dati reali:** verifica la nomina dei fornitori come responsabili del trattamento, ubicazione e trasferimenti dei dati, regole di accesso del personale, copie di sicurezza e ripristino, tempi di conservazione, eventuale valutazione d'impatto e procedura di gestione delle violazioni. La presenza di un PDF nell'archivio non certifica da sola la conformità GDPR o una conservazione digitale a norma. Non condividere il link temporaneo di download del documento.


## Consenso informato online (beta 10)

Nella scheda del paziente trovi **Genera link consenso online**. Il server crea un token casuale, conserva soltanto la sua impronta SHA-256, lo collega al paziente e lo rende valido per 7 giorni. La generazione di un nuovo link invalida i precedenti link non ancora utilizzati per lo stesso paziente.

Dopo la generazione puoi:
- copiare il link;
- aprire WhatsApp con un messaggio già predisposto;
- aprire una nuova email con oggetto e testo già predisposti.

Il paziente apre il link senza accedere al gestionale, visualizza il testo del consenso, inserisce nome e cognome e data di nascita, seleziona la casella di conferma e invia. Il nominativo deve corrispondere a quello presente nella scheda paziente. Una volta completato, il link non è più utilizzabile.

La conferma crea automaticamente un documento nella scheda paziente e nella sezione **Documenti**. Sono registrati data e ora, versione del testo, metodo di conferma, impronta della dichiarazione e impronta SHA-256 della ricevuta. La ricevuta è conservata nel bucket privato `patient-files` e viene scaricata tramite URL temporaneo.

**Importante:** questa procedura documenta una conferma elettronica e non viene presentata come firma digitale qualificata. Il testo incluso è un modello operativo generico: prima dell'uso reale va verificato e, se necessario, adattato alla tua informativa, alle indicazioni dell'Ordine, al tuo assetto privacy e alle specifiche prestazioni offerte. La presenza del link, del log e della ricevuta non costituisce da sola certificazione di conformità GDPR o di conservazione digitale a norma.

Per l'aggiornamento da beta 9, prima di usare il pulsante online esegui il nuovo `schema.sql` su Supabase e poi pubblica tutti i file della beta 10 su GitHub/Vercel.

## Beta 12 - modulo consenso online basato sul PDF Studio Rocchi
Il pulsante **Genera link consenso online** nella scheda paziente apre ora un modulo completo basato sul modello "Modulo per la prestazione professionale psicologica (Consenso informato + condizioni economiche)".

Il paziente compila anagrafica, prestazione, modalità e consensi. Al salvataggio il server genera un PDF, lo archivia automaticamente nel bucket `patient-files`, crea il documento collegato alla scheda paziente e restituisce un link temporaneo per scaricarlo/stamparlo.

Non sono richieste nuove tabelle rispetto alla Beta 10/11: resta necessaria la tabella `consent_links` già presente nello `schema.sql` del progetto.

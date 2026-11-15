# Sincronizare rezervări – Casa Domnească Rarău

## Scop
Proiect separat, fără modificări în site-ul public, pentru centralizarea disponibilității celor 7 camere și pregătirea sincronizării Booking.com, Travelminit și Google Calendar.

## Inventarul camerelor

| ID intern | Travelminit | Booking.com |
|---|---|---|
| room-1 | Cameră dublă exclusivă cu baie | Cameră King superioară |
| room-2 | Cameră dublă Gold (pat suplimentar la cerere) | Cameră Queen Deluxe |
| room-3 | Cameră dublă cu baie | Cameră Dublă Deluxe |
| room-4 | Cameră dublă Lux cu baie (pat suplimentar la cerere) | Cameră dublă Deluxe cu pat suplimentar |
| room-5 | Cameră dublă standard | Cameră King |
| room-6 | Cameră cvadruplă Family cu baie | Nu este listată pe Booking |
| room-7 | Cameră cvadruplă la parter cu baie | Nu este listată pe Booking |

Maparea camerelor 1–5 urmează confirmarea proprietarului că numerele corespund pe ambele platforme. Camerele 6–7 există numai în inventarul Travelminit.

## Arhitectură propusă

1. **Calendar central**: câte un calendar Google separat pentru fiecare cameră; rezervările și blocările se păstrează cu sursa, intervalul, starea și un identificator intern.
2. **Adaptoare de canal**: componente separate pentru Booking.com și Travelminit. Se folosesc numai API-uri oficiale/autorizate sau exporturi/importuri iCal permise de fiecare platformă.
3. **Motor de reconciliere**: normalizează intervalele în fusul orar Europe/Bucharest, deduplică evenimentele și detectează modificări/anulări atunci când sursa oferă date suficiente.
4. **Jurnal și alerte**: fiecare import, modificare, conflict sau eroare se înregistrează; conflictele nu se rezolvă prin ștergerea automată a unei rezervări.
5. **Panou de administrare**: afișează starea sincronizării și conflictele, fără să expună URL-uri iCal sau credențiale.

## Limitări obligatoriu de respectat

- iCal este o metodă de sincronizare cu întârziere, nu un canal tranzacțional în timp real.
- Unele fluxuri iCal nu transmit anulări, modificări sau identificatori suficienți pentru reconciliere sigură.
- Nu se poate garanta prevenirea suprarezervărilor doar prin iCal. Până la existența unor API-uri oficiale bidirecționale și a confirmărilor de la platforme, sistemul trebuie prezentat ca sincronizare asistată/cu întârziere.
- Nu se va pretinde că există integrare API Booking/Travelminit înainte de obținerea accesului oficial și verificarea documentației/permisiunilor.
- Nu se introduc parole, coduri OTP, tokenuri sau URL-uri iCal private în GitHub, în codul frontend ori în acest document.

## Configurare necesară înainte de implementare

- Proiect Cloudflare separat pentru serviciul de sincronizare (sau un Worker separat), cu variabile secrete configurate în dashboard.
- OAuth Google Calendar cu permisiuni minime și acordul proprietarului; identificatorii calendarelor se păstrează în configurație, nu în codul public.
- Confirmarea accesului oficial la API Booking.com și Travelminit. Dacă nu există, se limitează funcționalitatea la iCal și se afișează explicit intervalul ultimei sincronizări.
- Politică de retenție pentru jurnal și procedură de backup.

## Etape de dezvoltare

- [ ] Verificarea posibilităților oficiale de integrare pentru fiecare platformă.
- [ ] Crearea celor 7 calendare Google și maparea lor la ID-urile interne.
- [ ] Import iCal într-un mediu de test, fără modificarea disponibilității publice.
- [ ] Teste pentru rezervare nouă, modificare, anulare, eveniment duplicat și suprapunere.
- [ ] Implementarea jurnalului și a alertelor de conflict.
- [ ] Activarea scrierii în calendarele și platformele reale numai după testare și aprobare explicită.

## Stare inițială cunoscută

A fost raportat anterior un import Booking → Travelminit reușit pentru o cameră, dar camera exactă nu este confirmată. A fost afișat un link de export iCal Travelminit; importul invers în Booking nu este confirmat. Aceste legături trebuie verificate în conturi, fără a copia tokenurile private în repository.

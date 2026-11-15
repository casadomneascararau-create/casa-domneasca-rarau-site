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


## Verificare oficială a integrărilor (15 noiembrie 2026)

### Booking.com
- Pagina oficială Booking.com Connectivity Portal afirmă că înscrierea noilor furnizori de conectivitate este suspendată până la noi informații.
- Booking.com precizează că proprietățile individuale nu se pot conecta direct la Connectivity APIs; proprietarii pot folosi un furnizor de conectivitate/channel manager.
- Prin urmare, pentru proiectul independent al unei singure pensiuni nu putem presupune că vom primi acces API. Nu vom construi sau activa apeluri API fără aprobarea oficială Booking.com.
- Surse oficiale:
  - https://connect.booking.com/
  - https://developers.booking.com/connectivity/docs

### Travelminit
- Documentația oficială Travelminit descrie sincronizarea iCalendar pentru unitățile eligibile.
- Eligibilitatea descrisă include unități cu mai multe tipuri de cameră, dacă există câte o singură unitate din fiecare tip; trebuie verificat în cont dacă inventarul concret al pensiunii este eligibil.
- Travelminit spune că sincronizarea nu este în timp real și poate dura până la 60 de minute.
- Rezervările de pe canale care nu pot fi sincronizate trebuie introduse manual în calendarul Travelminit.
- Sursa oficială: https://travelminit.ro/sincronizare-calendar-prin-icalendar

### Consecință de proiectare
- Prima versiune va fi un registru central și un instrument de monitorizare/reconciliere, nu un channel manager și nu un mecanism de blocare garantată în timp real.
- Se poate pregăti integrarea Google Calendar și procesarea iCal numai după verificarea eligibilității fiecărei camere și după testare.
- Orice eveniment importat va păstra sursa și momentul ultimei citiri; conflictele și anulările ambigue vor fi marcate pentru verificare, nu șterse automat.
- Nu vom promite sincronizare complet bidirecțională Booking ↔ Travelminit printr-un simplu calendar iCal.


## Meta Business Agent – verificare oficială (15 noiembrie 2026)

- WhatsApp descrie configurarea din fila **Tools / Instrumente → AI agent**, urmată de autentificare și confirmare în aplicația WhatsApp Business.
- Disponibilitatea nu este garantată pentru fiecare cont: centrul oficial de ajutor spune că funcția este disponibilă doar pentru anumite companii în anumite țări și că limbile nu sunt toate acceptate. Limba agentului este determinată de numărul de telefon al companiei.
- Dacă opțiunea nu apare în Instrumente, WhatsApp indică înscrierea pe lista de așteptare, dacă aceasta este oferită. Înscrierea nu garantează accesul și nu are un termen anunțat.
- După activare, agentul poate fi învățat din conversațiile anterioare și din informațiile furnizate de companie; WhatsApp/Meta menționează și site-ul, catalogul, documentele și listele de prețuri. Există controale pentru cine primește răspunsuri AI și predarea conversației către operator.
- Documentația Meta nu confirmă că agentul nativ poate scrie direct într-un Google Calendar arbitrar sau poate administra disponibilitatea Booking.com/Travelminit. Pentru asta este necesară o integrare separată, autorizată, testată.
- Plan: pregătim baza de cunoștințe a pensiunii și regulile de rezervare; activăm agentul nativ numai dacă apare în cont și limba este acceptată; pentru scrierea în Google Calendar folosim un serviciu separat cu OAuth și verificare de conflicte.

Surse oficiale:
- https://faq.whatsapp.com/1153795669452207/
- https://faq.whatsapp.com/810657551906035
- https://whatsappbusiness.com/products/business-app-ai-agent/
- https://ai.meta.com/ro-ro/meta-business-agent/platform/
